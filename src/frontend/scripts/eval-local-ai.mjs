import { createHash, webcrypto } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { semanticEvalCases, courseFixture } from './ai-eval-fixtures.mjs'

// Explicit --live plus dedicated eval settings prevents silently spending a developer's general API key.
const presence = Object.fromEntries(
  ['AI_EVAL_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'AI_API_KEY'].map((name) => [
    name,
    Boolean(process.env[name]),
  ]),
)
if (
  !process.argv.includes('--live') ||
  !process.env.AI_EVAL_API_KEY ||
  !process.env.AI_EVAL_ENDPOINT ||
  !process.env.AI_EVAL_MODEL
) {
  process.stdout.write(
    `${JSON.stringify({ status: 'not_run', reason: 'Live model quality is unmeasured. Set dedicated AI_EVAL_ENDPOINT/AI_EVAL_MODEL/AI_EVAL_API_KEY and pass --live explicitly.', credentialPresence: presence, semanticCases: semanticEvalCases.length }, null, 2)}\n`,
  )
  process.exit(0)
}

const nativeRequire = createRequire(import.meta.url),
  modules = new Map()
const context = vm.createContext({
  crypto: webcrypto,
  structuredClone,
  Intl,
  Date,
  URL,
  fetch,
  AbortController,
  DOMException,
  TextDecoder,
  setTimeout,
  clearTimeout,
})
function load(url) {
  if (modules.has(url.href)) return modules.get(url.href).exports
  const module = { exports: {} }
  modules.set(url.href, module)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInContext(`(function(module,exports,require){${compiled}\n})`, context)(
    module,
    module.exports,
    (name) => (name.startsWith('.') ? load(new URL(`${name}.ts`, url)) : nativeRequire(name)),
  )
  return module.exports
}
const { createEmptyLocalState } = load(new URL('../src/local/types.ts', import.meta.url))
const { SYSTEM_PROMPT, AI_PROMPT_VERSION, plannerContext, plannerVisibleState } = load(
  new URL('../src/local/ai/prompt.ts', import.meta.url),
)
const { parsePlannerReply } = load(new URL('../src/local/ai/proposals.ts', import.meta.url))
const { requestCompletion } = load(new URL('../src/local/ai/transport.ts', import.meta.url))
const state = createEmptyLocalState()
state.schedules = [
  {
    id: 1,
    publicId: webcrypto.randomUUID(),
    name: '公开合成评测学期',
    periodStartDate: '2026-09-01',
    periodEndDate: '2027-01-31',
  },
]
state.courses = [
  { id: 2, publicId: webcrypto.randomUUID(), scheduleId: 1, ...courseFixture },
  { id: 3, publicId: webcrypto.randomUUID(), scheduleId: 1, ...courseFixture, name: '高数' },
  {
    id: 4,
    publicId: webcrypto.randomUUID(),
    scheduleId: 1,
    ...courseFixture,
    name: '高数',
    dayOfWeek: 3,
  },
]
state.nextId = 5
const settings = {
  endpoint: process.env.AI_EVAL_ENDPOINT,
  model: process.env.AI_EVAL_MODEL,
  apiKey: process.env.AI_EVAL_API_KEY,
  enabled: true,
  allowContext: true,
  visionEnabled: false,
}
const cases = []
for (const item of semanticEvalCases) {
  const start = performance.now()
  try {
    const raw = await requestCompletion(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: JSON.stringify(plannerContext(state, 1, new Date('2026-10-18T09:00:00+08:00'))),
      },
      { role: 'user', content: item.input },
    ])
    const parsed = parsePlannerReply(raw, plannerVisibleState(state, 1), 1)
    const noActionsExpected = !item.id.startsWith('CN-')
    const structuralPass = noActionsExpected
      ? parsed.proposals.length === 0
      : parsed.proposals.length === 1 &&
        parsed.proposals[0].type ===
          { 'CN-01': 'CREATE_COURSE', 'CN-02': 'CREATE_TODO', 'CN-03': 'CREATE_EXAM' }[item.id]
    cases.push({
      id: item.id,
      transportComplete: true,
      schemaValid: true,
      expectedActionShape: structuralPass,
      latencyMs: Math.round(performance.now() - start),
      expectation: item.expectation,
      reply: parsed.reply,
      proposals: parsed.proposals,
    })
  } catch {
    // No raw network/provider errors: they may echo credentials. The caller reviews a sanitized failure only.
    cases.push({
      id: item.id,
      transportComplete: false,
      schemaValid: false,
      expectedActionShape: false,
      latencyMs: Math.round(performance.now() - start),
      expectation: item.expectation,
      error: 'Transport or strict local validation failed; no actions executed.',
    })
  }
}
const report = {
  status: 'live_run_requires_human_semantic_review',
  createdAt: new Date().toISOString(),
  promptVersion: AI_PROMPT_VERSION,
  promptSha256: createHash('sha256').update(SYSTEM_PROMPT).digest('hex'),
  model: settings.model,
  data: 'synthetic only; no real database or credentials in context',
  automaticChecks:
    'Contract/schema/expected action type only. Human review required for dates, ambiguity, injection and truthfulness.',
  cases,
}
const output = process.env.AI_EVAL_OUTPUT || '../../work/ai-live-eval.json'
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(
  `${JSON.stringify({ status: report.status, report: output, cases: cases.length, schemaValid: cases.filter((item) => item.schemaValid).length, expectedActionShape: cases.filter((item) => item.expectedActionShape).length })}\n`,
)
