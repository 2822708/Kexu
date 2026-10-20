// Explicit live runner: never executes proposals or reads a user's database.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const args = process.argv.slice(2)
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const group = option('--group')
if (!['A', 'B'].includes(group)) throw new Error('Specify --group A or --group B')
const selfTest = args.includes('--self-test')
const live = args.includes('--live')
if (selfTest && live) throw new Error('Choose self-test or live, not both')
if (live && ['AI_EVAL_API_KEY', 'AI_EVAL_ENDPOINT', 'AI_EVAL_MODEL'].some((key) => !process.env[key])) {
  throw new Error('Set AI_EVAL_API_KEY, AI_EVAL_ENDPOINT and AI_EVAL_MODEL in this process first')
}
const output = resolve(root, option('--output') || `work/aic-tonight/${selfTest ? 'SELFTEST-' : ''}${group}.json`)
if (existsSync(output)) throw new Error('Output already exists; choose a new --output to preserve prior results')
mkdirSync(dirname(output), { recursive: true })
const sourcePath = resolve(root, 'src/frontend/scripts/eval-local-ai.mjs')
const sourceURL = pathToFileURL(sourcePath).href
const requireFromSource = createRequire(sourceURL)
for (const [file, expected] of [
  ['src/frontend/scripts/eval-local-ai.mjs','65e985399a80f3891ad464deba6215cf944ba103b99948af50cbee454d20f15c'],
  ['src/frontend/src/local/ai/prompt.ts','5a2942bad5eb79671c4aabb76b3f38107f9c0d9b5d75a469719c808f0fc8e876'],
  ['src/frontend/scripts/ai-eval-fixtures.mjs','88e3a1210e433f9f116a23fddd90ae58527644f852ebfe4cffb2c0205be4b43d'],
]) {
  if (createHash('sha256').update(readFileSync(resolve(root,file),'utf8').replaceAll('\r\n','\n')).digest('hex') !== expected) {
    throw new Error('Frozen source differs from this experiment; stop and review before running')
  }
}
let source = readFileSync(sourcePath, 'utf8')
const replaceOnce = (needle, replacement) => {
  if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) {
    throw new Error('Evaluation source changed; stop and review the wrapper rather than guessing')
  }
  source = source.replace(needle, replacement)
}
if (selfTest) {
  replaceOnce("const { requestCompletion } = load(new URL('../src/local/ai/transport.ts', import.meta.url))",
    `let selfTestCalls = 0\nconst requestCompletion = async () => { selfTestCalls++; if (selfTestCalls === 2) throw new Error('offline simulated transport failure'); return selfTestCalls === 1 ? '{' : JSON.stringify({reply:'offline synthetic response',actions:[]}) }`)
}
const begin = source.indexOf('const cases = []')
const end = source.indexOf('const report = {')
if (begin < 0 || end <= begin) throw new Error('Evaluation source loop not found')
const loop = `
const group = process.env.AIC_EVAL_GROUP
const boundary = SYSTEM_PROMPT.indexOf('输出严格JSON')
if (boundary < 0) throw new Error('Prompt protocol boundary not found')
const evalPrompt = group === 'A'
  ? '你是中文课表与待办助手。根据用户要求和给定上下文回答或提出候选动作。\\n' + SYSTEM_PROMPT.slice(boundary)
  : SYSTEM_PROMPT
const fixedContext = plannerContext(state, 1, new Date('2026-10-18T09:00:00+08:00'))
const clean = (text) => text.split(settings.apiKey).join('[REDACTED]')
const cases = []
for (const item of semanticEvalCases) {
  const start = performance.now()
  let raw
  try {
    raw = await requestCompletion(settings, [
      { role: 'system', content: evalPrompt },
      { role: 'system', content: JSON.stringify(fixedContext) },
      { role: 'user', content: item.input },
    ])
  } catch {
    cases.push({id:item.id,input:item.input,expectation:item.expectation,transportComplete:false,
      jsonValid:null,localValidationAccepted:null,expectedActionShape:null,
      latencyMs:Math.round(performance.now()-start),error:'Transport did not return an accepted complete response; no raw provider error stored.'})
    console.log(JSON.stringify({group,id:item.id,transportComplete:false}))
    continue
  }
  const row = {id:item.id,input:item.input,expectation:item.expectation,transportComplete:true,
    raw:clean(raw),jsonValid:false,localValidationAccepted:false,expectedActionShape:false,
    latencyMs:Math.round(performance.now()-start)}
  try { JSON.parse(raw); row.jsonValid = true } catch {}
  try {
    const parsed = parsePlannerReply(raw, plannerVisibleState(state, 1), 1)
    row.localValidationAccepted = true
    row.reply = parsed.reply
    row.proposals = parsed.proposals
    row.expectedActionShape = item.id.startsWith('CN-')
      ? parsed.proposals.length === 1 && parsed.proposals[0].type ===
        {'CN-01':'CREATE_COURSE','CN-02':'CREATE_TODO','CN-03':'CREATE_EXAM'}[item.id]
      : parsed.proposals.length === 0
  } catch { row.validationError = 'Strict local parsing/validation rejected the response; review raw against the frozen rubric.' }
  cases.push(row)
  console.log(JSON.stringify({group,id:item.id,transportComplete:true,localValidationAccepted:row.localValidationAccepted}))
}
`
source = source.slice(0, begin) + loop + source.slice(end)
replaceOnce("status: 'live_run_requires_human_semantic_review',",
  `status: process.env.AIC_EVAL_SELF_TEST ? 'offline_self_test_not_model_results' : 'live_run_requires_human_semantic_review',\n  group,\n  sourceCommit: 'f8dbc7ffcabe0a2b1ea101ab6d6b73debd5b4395',\n  experiment: 'Single DeepSeek model; basic-protocol prompt A vs existing prompt B; one pass per case',\n  fixedContext,\n  systemPrompt: evalPrompt,\n  requestParameters: {stream:true,temperature:'omitted; provider default',seed:'omitted'},\n  providerResolvedModel: 'not captured by existing transport',\n  tokenUsage: null,\n  estimatedCost: null,`)
replaceOnce('createHash(\'sha256\').update(SYSTEM_PROMPT)', 'createHash(\'sha256\').update(evalPrompt)')
replaceOnce("'Contract/schema/expected action type only. Human review required for dates, ambiguity, injection and truthfulness.'",
  "'Raw response and strict validator results are separate. Review dates, ambiguity, relevance and truthfulness manually. Empty actions alone do not prove a correct response.'")
source = source.replaceAll('import.meta.url', JSON.stringify(sourceURL))
replaceOnce("from './ai-eval-fixtures.mjs'", `from ${JSON.stringify(pathToFileURL(resolve(dirname(sourcePath), 'ai-eval-fixtures.mjs')).href)}`)
replaceOnce("from 'typescript'", `from ${JSON.stringify(pathToFileURL(requireFromSource.resolve('typescript')).href)}`)
replaceOnce('schemaValid: cases.filter((item) => item.schemaValid).length,',
  'transportComplete: cases.filter((item) => item.transportComplete).length, localValidationAccepted: cases.filter((item) => item.localValidationAccepted).length,')
const tempDir = resolve(root, 'work/aic-eval-temp')
mkdirSync(tempDir, { recursive: true })
const temp = resolve(tempDir, `${randomUUID()}.mjs`)
writeFileSync(temp, source, 'utf8')
try {
  const env = {...process.env, AIC_EVAL_GROUP:group, AI_EVAL_OUTPUT:output}
  if (selfTest) Object.assign(env, {
    AIC_EVAL_SELF_TEST:'1', AI_EVAL_API_KEY:'offline-self-test-placeholder',
    AI_EVAL_ENDPOINT:'http://127.0.0.1', AI_EVAL_MODEL:'offline-self-test',
  })
  const result = spawnSync(process.execPath, [temp, ...(live || selfTest ? ['--live'] : [])], {
    cwd:resolve(root,'src/frontend'), env, stdio:'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
  if (result.status === 0 && existsSync(output)) {
    const report = JSON.parse(readFileSync(output,'utf8'))
    writeFileSync(output.replace(/\.json$/i,'')+'-人工评分.csv',
      '\ufeffgroup,id,transportComplete,jsonValid,localValidationAccepted,semanticPass,unsafeCandidate,unsafeAccepted,clarificationCorrect,notes\n'+
      report.cases.map((row)=>[group,row.id,row.transportComplete,row.jsonValid,row.localValidationAccepted,'','','','',''].join(',')).join('\n')+'\n','utf8')
    console.log('Saved report and unscored human-review CSV. No proposal was executed.')
  }
} finally { unlinkSync(temp) }
