import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import ts from 'typescript'

async function setup(t, withConversation = false) {
  const modules = new Map()
  const context = vm.createContext({
    indexedDB: new IDBFactory(),
    crypto: webcrypto,
    structuredClone,
    setTimeout,
    clearTimeout,
  })
  function loadSource(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }
    modules.set(url.href, module)
    const { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
      compilerOptions: {
        allowJs: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: url.pathname.endsWith('.mjs') ? 'source.js' : 'source.ts',
    })
    const run = vm.compileFunction(outputText, ['module', 'exports', 'require'], {
      parsingContext: context,
      filename: url.pathname,
    })
    run(module, module.exports, (name) => {
      assert.ok(name.startsWith('.'), `Unexpected dependency ${name}`)
      return loadSource(new URL(/\.mjs$/.test(name) ? name : `${name}.ts`, url))
    })
    return module.exports
  }
  const { readLocalState, mutateLocalState, closeLocalStore } = loadSource(
    new URL('../src/local/db.ts', import.meta.url),
  )
  t.after(() => closeLocalStore())
  const { newPublicId, nextLocalId } = loadSource(new URL('../src/local/types.ts', import.meta.url))
  const { createImageSchedule } = loadSource(new URL('../src/local/ai/imageSchedule.ts', import.meta.url))
  const conversation = withConversation
    ? await mutateLocalState((state) => {
        const fixture = {
          id: nextLocalId(state),
          publicId: newPublicId(),
          scheduleId: null,
          title: 'Synthetic chat',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
        state.conversations.push(fixture)
        return fixture
      })
    : null
  const state = await readLocalState()
  const scope = {
    dataset: `${state.datasetId}:${state.dataGeneration}`,
    conversationId: conversation?.id ?? null,
    conversationPublicId: conversation?.publicId ?? null,
  }
  return { createImageSchedule, readLocalState, mutateLocalState, newPublicId, scope, state }
}

const term = {
  name: 'Synthetic term',
  periodStartDate: '2026-08-31',
  periodEndDate: '2027-01-31',
}

test('creating the first image timetable without a chat does not create a chat or course', async (t) => {
  const x = await setup(t)
  const result = await x.createImageSchedule(term, x.scope)
  const state = await x.readLocalState()
  assert.equal(result.name, term.name)
  assert.deepEqual(state.schedules[0], structuredClone(result))
  assert.equal(state.schedules.length, 1)
  assert.equal(state.conversations.length, 0)
  assert.equal(state.courses.length, 0)
})

test('first image timetable binds the exact unbound chat in the same database revision', async (t) => {
  const x = await setup(t, true)
  const result = await x.createImageSchedule(term, x.scope)
  const state = await x.readLocalState()
  assert.equal(state.schedules[0].id, result.id)
  assert.equal(state.conversations[0].scheduleId, result.id)
  assert.equal(state.conversations[0].publicId, x.scope.conversationPublicId)
  assert.notEqual(state.conversations[0].updatedAt, x.state.conversations[0].updatedAt)
  assert.equal(state.revision, x.state.revision + 1)
  assert.equal(state.courses.length, 0)
  assert.equal(state.messages.length, 0)
})

test('wrong chat, invalid term and stale dataset leave the schedule and chat unchanged', async (t) => {
  const x = await setup(t, true)
  await assert.rejects(
    x.createImageSchedule(term, { ...x.scope, conversationPublicId: x.newPublicId() }),
    /当前对话已更换/,
  )
  await assert.rejects(
    x.createImageSchedule({ ...term, periodEndDate: '2026-08-30' }, x.scope),
    /学期结束日期不能早于/,
  )
  assert.deepEqual(await x.readLocalState(), x.state)

  await x.mutateLocalState((state) => { state.dataGeneration = x.newPublicId() })
  const before = await x.readLocalState()
  await assert.rejects(x.createImageSchedule(term, x.scope), /本机数据已更换/)
  assert.deepEqual(await x.readLocalState(), before)
})

test('two attempts to create the first timetable commit only one schedule', async (t) => {
  const x = await setup(t, true)
  const outcomes = await Promise.allSettled([
    x.createImageSchedule(term, x.scope),
    x.createImageSchedule({ ...term, name: 'Other term' }, x.scope),
  ])
  const committed = outcomes.find((outcome) => outcome.status === 'fulfilled')
  assert.ok(committed)
  assert.match(outcomes.find((outcome) => outcome.status === 'rejected')?.reason.message, /已经有可用课表/)
  const state = await x.readLocalState()
  assert.equal(state.schedules.length, 1)
  assert.equal(state.conversations[0].scheduleId, committed.value.id)
  assert.equal(state.revision, x.state.revision + 1)
})
