import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import ts from 'typescript'

// fake-indexeddb implements IndexedDB requests/transactions, rather than mocking our DB facade.
// Each case receives a fresh database factory; close/reopen retains that factory's persisted records.
function setup(indexedDB = new IDBFactory()) {
  const modules = new Map()
  const nativeRequire = createRequire(import.meta.url)
  const context = vm.createContext({
    indexedDB,
    crypto: webcrypto,
    structuredClone,
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
  })
  function loadSource(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }
    modules.set(url.href, module)
    const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
      fileName: url.pathname.endsWith('.mjs') ? 'compat.js' : 'source.ts',
      compilerOptions: {
        allowJs: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
    const fn = vm.runInContext(`(function(module,exports,require){${compiled}\n})`, context, {
      filename: url.pathname,
    })
    fn(module, module.exports, (name) =>
      name.startsWith('.') ? loadSource(new URL(/\.[cm]?[jt]sx?$/.test(name) ? name : `${name}.ts`, url)) : nativeRequire(name),
    )
    return module.exports
  }
  const db = loadSource(new URL('../src/local/db.ts', import.meta.url))
  const domain = loadSource(new URL('../src/local/domain.ts', import.meta.url))
  const types = loadSource(new URL('../src/local/types.ts', import.meta.url))
  const scopes = loadSource(new URL('../src/local/editorScope.ts', import.meta.url))
  return { ...db, ...domain, ...types, ...scopes }
}
const scheduleBody = {
  name: '离线学期',
  periodStartDate: '2026-09-01',
  periodEndDate: '2027-01-31',
}
const courseBody = {
  name: '数学',
  location: null,
  teacher: null,
  dayOfWeek: 1,
  startPeriod: 1,
  endPeriod: 2,
  weeks: [1, 2, 3, 4],
}
const todoBody = { title: '本地任务', ddl: '2040-01-01T10:00' }
const examBody = {
  name: '离线考试',
  location: '教室',
  examDate: '2026-10-01',
  startTime: '09:00',
  endTime: '11:00',
}
const recurringBody = {
  title: '喝水',
  frequency: 'DAILY',
  dayOfWeek: null,
  dayOfMonth: null,
  triggerTime: '09:00',
  script: null,
  ddlOffsetMinutes: 60,
  enabled: true,
  chainAfterComplete: false,
}
const normal = (x) => JSON.parse(JSON.stringify(x))

test('concurrent first initialization shares one dataset and survives database reopen', async () => {
  const x = setup()
  const [a, b] = await Promise.all([x.initializeLocalStore(), x.initializeLocalStore()])
  assert.equal(a.datasetId, b.datasetId)
  assert.equal(a.revision, 0)
  assert.equal(a.periods.length, 12)
  await x.localScheduleApi.create(scheduleBody)
  await x.closeLocalStore()
  const restored = await x.readLocalState()
  assert.equal(restored.datasetId, a.datasetId)
  assert.equal(restored.schedules[0].name, scheduleBody.name)
  assert.equal(restored.revision, 1)
})
test('40 concurrent IDB writes allocate unique IDs and commit every record', async () => {
  const x = setup()
  let notifications = 0
  const stop = x.subscribeLocalChanges(() => notifications++)
  const rows = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      x.localTodoApi.create({ ...todoBody, title: `task ${i}` }),
    ),
  )
  const s = await x.readLocalState()
  assert.equal(s.todos.length, 40)
  assert.equal(new Set(rows.map((r) => r.id)).size, 40)
  assert.equal(new Set(rows.map((r) => r.publicId)).size, 40)
  assert.equal(s.revision, 40)
  assert.equal(notifications, 40)
  stop()
})
test('separate browser-module instances serialize writes and reject stale restore previews', async () => {
  const sharedFactory = new IDBFactory(),
    a = setup(sharedFactory),
    b = setup(sharedFactory)
  const initial = await a.initializeLocalStore()
  assert.equal((await b.initializeLocalStore()).datasetId, initial.datasetId)
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? a : b).localTodoApi.create({ ...todoBody, title: `cross-tab ${i}` }),
    ),
  )
  const state = await a.readLocalState()
  assert.equal(state.todos.length, 20)
  assert.equal(new Set(state.todos.map((t) => t.id)).size, 20)
  await b.localTodoApi.create(todoBody)
  await assert.rejects(a.replaceLocalState(state, state.revision), /已改变/)
  assert.equal((await a.readLocalState()).todos.length, 21)
})
test('read results and returned entities cannot mutate persisted state', async () => {
  const x = setup(),
    row = await x.localTodoApi.create(todoBody)
  row.title = 'tampered'
  const state = await x.readLocalState()
  state.todos[0].title = 'changed without transaction'
  assert.equal((await x.readLocalState()).todos[0].title, todoBody.title)
})
test('no-op maintenance and read transactions do not advance revision or trigger backup notifications', async () => {
  const x = setup(),
    initial = await x.initializeLocalStore()
  let changes = 0
  const stop = x.subscribeLocalChanges(() => changes++)
  await x.mutateLocalState(() => null)
  await x.runLocalMaintenance('2026-01-01T00:00:00')
  await x.localTodoApi.list()
  assert.equal((await x.readLocalState()).revision, initial.revision)
  assert.equal(changes, 0)
  stop()
})
test('failed multi-operation transaction rolls back records, revision and ID allocation', async () => {
  const x = setup(),
    schedule = await x.localScheduleApi.create(scheduleBody)
  const before = await x.readLocalState()
  await assert.rejects(
    x.mutateLocalState((s) => {
      x.applyLocalOperation(s, 'CREATE_TODO', { todos: [todoBody] }, null)
      x.applyLocalOperation(
        s,
        'CREATE_COURSE',
        { courses: [{ ...courseBody, dayOfWeek: 8 }] },
        schedule.id,
      )
    }),
    /星期/,
  )
  assert.deepEqual(await x.readLocalState(), before)
})
test('async transaction callbacks are rejected rather than partially committed', async () => {
  const x = setup(),
    before = await x.readLocalState()
  await assert.rejects(
    x.mutateLocalState(async (s) => {
      s.nextId++
      return 1
    }),
    /同步/,
  )
  assert.deepEqual(await x.readLocalState(), before)
})
test('AI operation enforces selected schedule within its transaction', async () => {
  const x = setup(),
    a = await x.localScheduleApi.create(scheduleBody),
    b = await x.localScheduleApi.create({ ...scheduleBody, name: 'other' })
  const course = await x.localCourseApi.create(a.id, courseBody)
  await assert.rejects(
    x.mutateLocalState((s) =>
      x.applyLocalOperation(s, 'DELETE_COURSE', { courseIds: [course.id] }, b.id),
    ),
    /工作课表/,
  )
  assert.equal((await x.readLocalState()).courses.length, 1)
})
test('date validation rejects impossible dates and reversed terms, accepts leap day', async () => {
  const x = setup()
  await assert.rejects(
    x.localScheduleApi.create({ ...scheduleBody, periodStartDate: '2026-02-30' }),
    /日期/,
  )
  await assert.rejects(
    x.localScheduleApi.create({ ...scheduleBody, periodEndDate: '2026-01-01' }),
    /结束/,
  )
  await x.localScheduleApi.create({
    ...scheduleBody,
    periodStartDate: '2028-02-29',
    periodEndDate: '2028-03-01',
  })
  await assert.rejects(x.localTodoApi.create({ ...todoBody, ddl: '2026-02-29T10:00' }), /日期/)
  assert.equal((await x.readLocalState()).schedules.length, 1)
})
test('course batch rejects atomically and normalizes distinct teaching weeks', async () => {
  const x = setup(),
    s = await x.localScheduleApi.create(scheduleBody)
  await assert.rejects(
    x.localCourseApi.batchCreate(s.id, [courseBody, { ...courseBody, weeks: [0] }]),
    /周次/,
  )
  assert.equal((await x.readLocalState()).courses.length, 0)
  const row = await x.localCourseApi.create(s.id, { ...courseBody, weeks: [3, 1, 3] })
  assert.deepEqual(normal(row.weeks), [1, 3])
})
test('exam CRUD creates, updates, completes and cascades its linked todo', async () => {
  const x = setup(),
    s = await x.localScheduleApi.create(scheduleBody),
    e = await x.localExamApi.create(s.id, examBody)
  const initial = (await x.readLocalState()).todos[0]
  assert.equal(initial.examId, e.id)
  assert.equal(initial.ddl, '2026-10-01T09:00:00')
  await x.localExamApi.update(e.id, { ...examBody, name: '改期考试', startTime: '10:00' })
  const updated = (await x.readLocalState()).todos[0]
  assert.equal(updated.publicId, initial.publicId)
  assert.equal(updated.title, '改期考试')
  assert.equal(updated.ddl, '2026-10-01T10:00:00')
  await x.runLocalMaintenance('2026-10-01T11:00:00')
  assert.equal((await x.readLocalState()).todos[0].completed, true)
  await x.localExamApi.remove(e.id)
  assert.equal((await x.readLocalState()).todos.length, 0)
})
test('schedule deletion removes dependent data and invalidates bound pending AI proposals', async () => {
  const x = setup(),
    s = await x.localScheduleApi.create(scheduleBody)
  const c = await x.localCourseApi.create(s.id, courseBody)
  await x.localFocusApi.setCourseCompleted(c.id, {
    scheduleId: s.id,
    date: '2026-09-07',
    completed: true,
  })
  await x.localExamApi.create(s.id, examBody)
  await x.localTodoApi.create(todoBody)
  await x.mutateLocalState((state) => {
    const id = x.nextLocalId(state)
    state.conversations.push({
      id,
      publicId: x.newPublicId(),
      scheduleId: s.id,
      title: 'conversation',
    })
    state.messages.push({
      messageId: x.nextLocalId(state),
      publicId: x.newPublicId(),
      conversationId: id,
      role: 'assistant',
      text: '',
      actions: [
        {
          actionId: 1,
          type: 'CREATE_COURSE',
          status: 'PENDING',
          scope: 'COURSE',
          scheduleId: s.id,
          data: {},
        },
      ],
    })
  })
  await x.localScheduleApi.remove(s.id)
  const state = await x.readLocalState()
  assert.equal(state.courses.length + state.exams.length + state.focusCompletions.length, 0)
  assert.equal(state.todos.length, 1)
  assert.equal(state.conversations[0].scheduleId, null)
  assert.equal(state.messages[0].actions[0].status, 'STALE')
})
test('focus completion validates term/date/teaching week and is idempotent', async () => {
  const x = setup(),
    s = await x.localScheduleApi.create(scheduleBody),
    c = await x.localCourseApi.create(s.id, courseBody)
  const body = { scheduleId: s.id, date: '2026-09-07', completed: true }
  await Promise.all([
    x.localFocusApi.setCourseCompleted(c.id, body),
    x.localFocusApi.setCourseCompleted(c.id, body),
  ])
  assert.deepEqual(normal(await x.localFocusApi.completedCourseIds(s.id, body.date)), [c.id])
  await assert.rejects(
    x.localFocusApi.setCourseCompleted(c.id, { ...body, date: '2026-09-08' }),
    /没有安排/,
  )
  await assert.rejects(
    x.localFocusApi.setCourseCompleted(c.id, { ...body, date: '2026-10-05' }),
    /没有安排/,
  )
  await x.localCourseApi.update(c.id, { ...courseBody, dayOfWeek: 2 })
  assert.equal((await x.readLocalState()).focusCompletions.length, 0)
})
test('fixed recurrence handles strict daily/weekly and leap/non-leap month ends', () => {
  const x = setup(),
    r = { ...recurringBody, triggerTime: '09:00:00' }
  assert.equal(x.nextTriggerAfter(r, '2026-10-18T09:00:00'), '2026-10-19T09:00:00')
  assert.equal(
    x.nextTriggerAfter({ ...r, frequency: 'WEEKLY', dayOfWeek: 1 }, '2026-10-18T10:00:00'),
    '2026-10-19T09:00:00',
  )
  assert.equal(
    x.nextTriggerAfter({ ...r, frequency: 'MONTHLY', dayOfMonth: 31 }, '2028-02-01T10:00:00'),
    '2028-02-29T09:00:00',
  )
  assert.equal(
    x.nextTriggerAfter({ ...r, frequency: 'MONTHLY', dayOfMonth: 31 }, '2026-02-28T09:00:00'),
    '2026-03-31T09:00:00',
  )
})
test('concurrent missed-period scans cap catch-up to five and retain a future cursor', async () => {
  const x = setup(),
    r = await x.localRecurringApi.create(recurringBody)
  await x.mutateLocalState((s) => {
    s.recurringRules.find((a) => a.id === r.id).nextTriggerAt = '2026-01-01T09:00:00'
  })
  await Promise.all([
    x.runLocalMaintenance('2026-02-01T10:00:00'),
    x.runLocalMaintenance('2026-02-01T10:00:00'),
  ])
  const s = await x.readLocalState()
  assert.equal(s.todos.length, 5)
  assert.equal(s.recurringOccurrences.length, 5)
  assert.equal(s.recurringRules[0].nextTriggerAt, '2026-02-02T09:00:00')
})
test('CUSTOM stores script inertly and deletion preserves generated fixed-rule todo history', async () => {
  const x = setup()
  const r = await x.localRecurringApi.create({
    ...recurringBody,
    frequency: 'CUSTOM',
    script: 'throw new Error("must never execute")',
  })
  await x.runLocalMaintenance('2040-01-01T10:00:00')
  assert.equal((await x.readLocalState()).todos.length, 0)
  await assert.rejects(x.localRecurringApi.triggerNow(r.id), /不执行脚本/)
  const fixed = await x.localRecurringApi.create(recurringBody)
  await x.localRecurringApi.triggerNow(fixed.id)
  await x.localRecurringApi.remove(fixed.id)
  const s = await x.readLocalState()
  assert.equal(s.todos.length, 1)
  assert.equal(s.todos[0].recurringId, null)
  assert.equal(s.recurringOccurrences.length, 0)
})
test('complete/reopen/recomplete chains the next period at most once, persisted over reopen', async () => {
  const x = setup(),
    r = await x.localRecurringApi.create({ ...recurringBody, chainAfterComplete: true })
  await x.mutateLocalState((s) => {
    s.recurringRules[0].nextTriggerAt = '2040-01-01T09:00:00'
  })
  await x.runLocalMaintenance('2040-01-01T09:00:00')
  const first = (await x.readLocalState()).todos[0]
  await x.localTodoApi.toggle(first.id)
  await x.closeLocalStore()
  await x.localTodoApi.toggle(first.id)
  await x.localTodoApi.toggle(first.id)
  const s = await x.readLocalState()
  assert.equal(s.todos.length, 2)
  assert.equal(s.todos[0].chainGenerated, true)
  assert.equal(s.recurringRules.find((v) => v.id === r.id).nextTriggerAt, '2040-01-03T09:00:00')
})
test('manual repeated trigger deduplicates a minute and deleting a generated todo keeps a tombstone', async () => {
  const x = setup(),
    r = await x.localRecurringApi.create(recurringBody)
  await Promise.all([x.localRecurringApi.triggerNow(r.id), x.localRecurringApi.triggerNow(r.id)])
  let s = await x.readLocalState()
  assert.equal(s.todos.length, 1)
  const occurrence = s.recurringOccurrences[0]
  await x.localTodoApi.remove(s.todos[0].id)
  await x.mutateLocalState((s) => {
    s.recurringRules[0].nextTriggerAt = occurrence.scheduledAt
  })
  await x.runLocalMaintenance(occurrence.scheduledAt)
  s = await x.readLocalState()
  assert.equal(s.todos.length, 0)
  assert.equal(s.recurringOccurrences.length, 1)
  assert.equal(s.recurringOccurrences[0].todoId, null)
})
test('replace uses optimistic revision, validates relationships and preserves local dataset identity', async () => {
  const x = setup(),
    before = await x.readLocalState(),
    incoming = x.createEmptyLocalState()
  incoming.datasetId = x.newPublicId()
  incoming.schedules.push({ id: 1, publicId: x.newPublicId(), ...scheduleBody })
  incoming.nextId = 2
  await x.replaceLocalState(incoming, before.revision)
  let s = await x.readLocalState()
  assert.equal(s.datasetId, before.datasetId)
  assert.equal(s.createdAt, before.createdAt)
  assert.equal(s.revision, before.revision + 1)
  await assert.rejects(x.replaceLocalState(incoming, before.revision), /已改变/)
  const bad = structuredClone(s)
  bad.courses.push({ ...courseBody, id: bad.nextId++, publicId: x.newPublicId(), scheduleId: 999 })
  await assert.rejects(x.replaceLocalState(bad), /课表不存在/)
  s = await x.readLocalState()
  assert.equal(s.courses.length, 0)
})
test('period update preserves UUIDs and rejects overlapping times without a partial save', async () => {
  const x = setup(),
    before = await x.localPeriodApi.list()
  const changed = await x.localPeriodApi.update([
    { ...before[0], startTime: '07:50', endTime: '08:35' },
  ])
  assert.equal(changed[0].publicId, before[0].publicId)
  await assert.rejects(
    x.localPeriodApi.update([{ ...before[0] }, { ...before[1], startTime: '08:30' }]),
    /重叠/,
  )
  assert.equal((await x.localPeriodApi.list()).length, 1)
})
test('invalid persisted AI action IDs or enums abort rather than entering the main store', async () => {
  const x = setup()
  await assert.rejects(
    x.mutateLocalState((state) => {
      const conversationId = x.nextLocalId(state)
      state.conversations.push({
        id: conversationId,
        publicId: x.newPublicId(),
        scheduleId: null,
        title: 'local chat',
      })
      state.messages.push({
        messageId: x.nextLocalId(state),
        publicId: x.newPublicId(),
        conversationId,
        role: 'assistant',
        text: '',
        actions: [
          {
            actionId: x.nextLocalId(state),
            type: 'RUN_SCRIPT',
            status: 'PENDING',
            scope: 'TODO',
            data: {},
          },
        ],
      })
    }),
    /AI提案类型/,
  )
  assert.equal((await x.readLocalState()).messages.length, 0)
})

test('an editor bound to A rejects switching to B or replacing A under the same numeric ID', async () => {
  const x = setup(),
    a = await x.localScheduleApi.create(scheduleBody),
    b = await x.localScheduleApi.create({ ...scheduleBody, name: 'B' })
  const scope = x.captureEditorScope(a)
  let state = await x.readLocalState()
  assert.throws(() => x.assertEditorScope(scope, b, state), /切换、删除或恢复/)
  x.assertEditorScope(scope, a, state)
  await x.mutateLocalState((s) => {
    s.schedules.find((row) => row.id === a.id).publicId = x.newPublicId()
  })
  state = await x.readLocalState()
  assert.throws(() => x.assertEditorScope(scope, a, state), /切换、删除或恢复/)
  assert.equal(state.courses.length, 0)
})
test('course and exam editors require original UUID and membership in the captured schedule', async () => {
  const x = setup(),
    a = await x.localScheduleApi.create(scheduleBody),
    b = await x.localScheduleApi.create({ ...scheduleBody, name: 'B' })
  const course = await x.localCourseApi.create(b.id, courseBody),
    exam = await x.localExamApi.create(a.id, examBody)
  const scope = x.captureEditorScope(a),
    state = await x.readLocalState()
  assert.throws(() => x.assertEditorRecord(state, scope, 'courses', course), /不属于当前课表/)
  x.assertEditorRecord(state, scope, 'exams', exam)
  assert.throws(
    () => x.assertEditorRecord(state, scope, 'exams', { ...exam, publicId: x.newPublicId() }),
    /恢复替换/,
  )
})
test('deleting A after scope validation cannot reroute a captured create into surviving B', async () => {
  const x = setup(),
    a = await x.localScheduleApi.create(scheduleBody),
    b = await x.localScheduleApi.create({ ...scheduleBody, name: 'B' })
  const scope = x.captureEditorScope(a)
  x.assertEditorScope(scope, a, await x.readLocalState())
  await x.localScheduleApi.remove(a.id)
  await assert.rejects(x.localCourseApi.create(scope.scheduleId, courseBody), /课表不存在/)
  await assert.rejects(x.localExamApi.create(scope.scheduleId, examBody), /课表不存在/)
  const state = await x.readLocalState()
  assert.equal(state.schedules[0].id, b.id)
  assert.equal(state.courses.length + state.exams.length, 0)
})
test('closing or replacing an import editor rejects its delayed result', () => {
  const x = setup()
  x.assertEditorGeneration(4, 4)
  assert.throws(() => x.assertEditorGeneration(4, 5), /过期解析结果已丢弃/)
})
