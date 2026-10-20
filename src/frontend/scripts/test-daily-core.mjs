import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import ts from 'typescript'

function setup(indexedDB = new IDBFactory()) {
  const modules = new Map(),
    nativeRequire = createRequire(import.meta.url)
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
  function load(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }
    modules.set(url.href, module)
    const code = ts.transpileModule(readFileSync(url, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInContext(`(function(module,exports,require){${code}\n})`, context)(
      module,
      module.exports,
      (name) => (name.startsWith('.') ? load(new URL(/\.[cm]?[jt]sx?$/.test(name) ? name : `${name}.ts`, url)) : nativeRequire(name)),
    )
    return module.exports
  }
  return {
    indexedDB,
    ...load(new URL('../src/local/db.ts', import.meta.url)),
    ...load(new URL('../src/local/types.ts', import.meta.url)),
    ...load(new URL('../src/local/domain.ts', import.meta.url)),
    ...load(new URL('../src/local/daily/commands.ts', import.meta.url)),
    ...load(new URL('../src/local/daily/review.ts', import.meta.url)),
    ...load(new URL('../src/local/daily/selectors.ts', import.meta.url)),
  }
}
const id = () => webcrypto.randomUUID()
const ctx = async (x) => ({
  expectedGeneration: (await x.readLocalState()).dataGeneration,
  operationId: id(),
})
const today = (x) => x.nowLocalDateTime().slice(0, 10)
const shift = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const row = async (x, publicId, date = today(x)) =>
  (await x.dailyApi.readWorkspace(date)).entries.find((e) => e.publicId === publicId)
const create = async (x, title = '只写标题', extra = {}) =>
  x.dailyApi.createTask({ ...(await ctx(x)), date: today(x), title, ...extra })
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function seedV1(x, value) {
  const req = x.indexedDB.open(x.LOCAL_DATABASE_NAME, 1)
  req.onupgradeneeded = () => req.result.createObjectStore('main')
  const db = await request(req)
  await new Promise((resolve, reject) => {
    const tx = db.transaction('main', 'readwrite')
    tx.objectStore('main').put(value, 'state')
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

test('v1 migration atomically keeps exact recovery state and never invents completion facts', async () => {
  const x = setup(),
    old = x.createEmptyLocalState()
  delete old.dataGeneration
  delete old.dayEntries
  delete old.dailyEvents
  delete old.dailyReviews
  old.schemaVersion = 1
  await seedV1(x, old)
  const next = await x.initializeLocalStore()
  assert.equal(next.schemaVersion, 2)
  assert.equal(next.datasetId, old.datasetId)
  assert.equal(next.periods[0].publicId, old.periods[0].publicId)
  assert.equal(next.dailyEvents.length, 0)
  const db = await request(x.indexedDB.open(x.LOCAL_DATABASE_NAME, 2))
  assert.equal(
    JSON.stringify(
      await request(
        db.transaction('main', 'readonly').objectStore('main').get('migration:v1:recovery'),
      ),
    ),
    JSON.stringify(old),
  )
  db.close()
  await x.closeLocalStore()
})

test('invalid v1 migration aborts instead of replacing data or keeping a partial recovery', async () => {
  const x = setup(),
    old = x.createEmptyLocalState()
  delete old.dataGeneration
  delete old.dayEntries
  delete old.dailyEvents
  delete old.dailyReviews
  old.schemaVersion = 1
  old.nextId = -1
  await seedV1(x, old)
  await assert.rejects(x.initializeLocalStore())
  const db = await request(x.indexedDB.open(x.LOCAL_DATABASE_NAME, 2)),
    tx = db.transaction('main', 'readonly')
  const [state, recovery] = await Promise.all([
    request(tx.objectStore('main').get('state')),
    request(tx.objectStore('main').get('migration:v1:recovery')),
  ])
  assert.equal(JSON.stringify(state), JSON.stringify(old))
  assert.equal(recovery, undefined)
  db.close()
  await x.closeLocalStore()
})

test('title-only tasks persist without fake deadline and duplicate create operation cannot repeat', async () => {
  const x = setup(),
    command = { ...(await ctx(x)), date: today(x), title: '取快递' }
  const [a, b] = await Promise.all([x.dailyApi.createTask(command), x.dailyApi.createTask(command)])
  assert.equal(Number(a.changed) + Number(b.changed), 1)
  const state = await x.readLocalState()
  assert.equal(state.dayEntries.length, 1)
  assert.equal(state.todos.length, 0)
  assert.equal((await row(x, a.entryPublicId)).ddl, null)
  await x.closeLocalStore()
})

test('two tabs completing the same version serialize, receipt retries and old undo are safe', async () => {
  const db = new IDBFactory(),
    a = setup(db),
    b = setup(db),
    added = await create(a)
  const entry = await row(a, added.entryPublicId),
    context = await ctx(a)
  const command = {
    ...context,
    entryPublicId: entry.publicId,
    expectedVersion: entry.version,
    completed: true,
  }
  const results = await Promise.allSettled([
    a.dailyApi.setCompleted(command),
    b.dailyApi.setCompleted({ ...command, operationId: id() }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    (await a.readLocalState()).dailyEvents.filter((e) => e.kind === 'complete').length,
    1,
  )
  assert.equal((await a.dailyApi.setCompleted(command)).changed, false)
  const completed = await row(a, entry.publicId),
    event = (await a.readLocalState()).dailyEvents.find((e) => e.kind === 'complete')
  await a.dailyApi.setPriority({
    ...(await ctx(a)),
    entryPublicId: entry.publicId,
    expectedVersion: completed.version,
    isPriority: true,
  })
  await assert.rejects(
    a.dailyApi.setCompleted({
      ...(await ctx(a)),
      entryPublicId: entry.publicId,
      completed: false,
      expectedVersion: completed.version,
      undoOf: event.publicId,
    }),
    /修改/,
  )
  const current = await row(a, entry.publicId)
  await a.dailyApi.setCompleted({
    ...(await ctx(a)),
    entryPublicId: entry.publicId,
    expectedVersion: current.version,
    completed: false,
  })
  const pending = await row(a, entry.publicId)
  await a.dailyApi.setCompleted({
    ...(await ctx(a)),
    entryPublicId: entry.publicId,
    expectedVersion: pending.version,
    completed: true,
  })
  assert.equal(a.projectDailyReview(await a.readLocalState(), today(a)).counts.completed, 1)
  await a.closeLocalStore()
  await b.closeLocalStore()
})

test('three priority cap is checked transactionally and cancellation does not fake full progress', async () => {
  const x = setup()
  for (let i = 0; i < 3; i++) await create(x, `重点${i}`, { isPriority: true })
  await assert.rejects(create(x, '第四项', { isPriority: true }), /三项/)
  const state = await x.readLocalState(),
    item = state.dayEntries[0]
  await x.dailyApi.setPriority({
    ...(await ctx(x)),
    entryPublicId: item.publicId,
    expectedVersion: item.version,
    isPriority: false,
  })
  assert.equal(x.projectDailyReview(await x.readLocalState(), today(x)).counts.priorityPlanned, 3)
  assert.equal((await x.readLocalState()).dayEntries.length, 3)
  await x.closeLocalStore()
})

test('linked todos share one global completion, external changes invalidate old operations', async () => {
  const x = setup(),
    todo = await x.localTodoApi.create({ title: '报告', ddl: '2040-01-01T20:00' })
  const planned = await x.dailyApi.planTodo({
    ...(await ctx(x)),
    date: today(x),
    todoPublicId: todo.publicId,
  })
  await x.dailyApi.planTodo({
    ...(await ctx(x)),
    date: shift(today(x), 1),
    todoPublicId: todo.publicId,
  })
  const old = await row(x, planned.entryPublicId)
  await x.localTodoApi.toggle(todo.id)
  await assert.rejects(
    x.dailyApi.setCompleted({
      ...(await ctx(x)),
      entryPublicId: old.publicId,
      expectedVersion: old.version,
      completed: true,
    }),
    /修改/,
  )
  assert.equal(x.projectDailyReview(await x.readLocalState(), today(x)).counts.completed, 1)
  assert.equal(
    x.projectDailyReview(await x.readLocalState(), shift(today(x), 1)).counts.completed,
    0,
  )
  await x.localTodoApi.remove(todo.id)
  const archived = await row(x, old.publicId)
  assert.equal(archived.missingSource, true)
  assert.equal(archived.title, '报告')
  assert.equal(x.projectDailyReview(await x.readLocalState(), today(x)).counts.completed, 1)
  await x.closeLocalStore()
})

test('future completion is forbidden and past backfill is counted once on its attributed date', async () => {
  const x = setup(),
    past = shift(today(x), -1)
  await assert.rejects(create(x, '明天', { date: shift(today(x), 1), completed: true }), /未来/)
  await assert.rejects(create(x, '昨天', { date: past, completed: true }), /更正模式/)
  await create(x, '补记昨天', { date: past, completed: true, allowPast: true })
  const state = await x.readLocalState(),
    e = state.dailyEvents[0]
  assert.equal(e.occurredAt, null)
  assert.equal(e.source, 'backfill')
  assert.equal(x.projectDailyReview(state, past).counts.completed, 1)
  assert.equal(x.projectDailyReview(state, today(x)).counts.completed, 0)
  await x.closeLocalStore()
})

test('automatic exam completion and legacy updatedAt never become active achievements', async () => {
  const x = setup(),
    schedule = await x.localScheduleApi.create({
      name: '学期',
      periodStartDate: '2020-01-01',
      periodEndDate: '2040-01-01',
    })
  await x.localExamApi.create(schedule.id, {
    name: '考试',
    location: null,
    examDate: today(x),
    startTime: '08:00',
    endTime: '09:00',
  })
  await x.runLocalMaintenance(`${today(x)}T10:00:00`)
  const state = await x.readLocalState()
  assert.equal(state.todos[0].completed, true)
  assert.equal(state.dailyEvents[0].source, 'system')
  assert.equal(x.projectDailyReview(state, today(x)).counts.completed, 0)
  assert.equal(x.hasDailyActivity(state, today(x)), false)
  await x.closeLocalStore()
})

test('restoring the same dataset changes generation and rejects stale completion and draft writes', async () => {
  const x = setup(),
    added = await create(x),
    context = await ctx(x),
    state = await x.readLocalState()
  await x.replaceLocalState(state, state.revision)
  assert.notEqual((await x.readLocalState()).dataGeneration, context.expectedGeneration)
  await assert.rejects(
    x.dailyApi.setCompleted({
      ...context,
      entryPublicId: added.entryPublicId,
      expectedVersion: 0,
      completed: true,
    }),
    /恢复或替换/,
  )
  await assert.rejects(
    x.dailyApi.saveReviewDraft({
      ...context,
      date: today(x),
      expectedVersion: 0,
      content: { feeling: '', text: '旧草稿', nextStep: '' },
    }),
    /恢复或替换/,
  )
  await x.closeLocalStore()
})

test('saved review, draft, facts refresh and stale fact conflict remain independent', async () => {
  const x = setup(),
    date = today(x),
    content = { feeling: '还可以', text: '自己的文字', nextStep: '喝水' }
  let facts = x.projectDailyReview(await x.readLocalState(), date)
  await x.dailyApi.saveReview({ ...(await ctx(x)), date, expectedVersion: 0, content, facts })
  let review = (await x.readLocalState()).dailyReviews[0],
    savedAt = review.saved.savedAt
  await x.dailyApi.saveReviewDraft({
    ...(await ctx(x)),
    date,
    expectedVersion: review.version,
    content: { ...content, text: '未提交' },
  })
  await create(x, '新任务')
  review = (await x.readLocalState()).dailyReviews[0]
  await assert.rejects(
    x.dailyApi.saveReview({
      ...(await ctx(x)),
      date,
      expectedVersion: review.version,
      content,
      facts,
    }),
    /事实已更新/,
  )
  facts = x.projectDailyReview(await x.readLocalState(), date)
  await x.dailyApi.refreshReviewFacts({
    ...(await ctx(x)),
    date,
    expectedVersion: review.version,
    facts,
  })
  review = (await x.readLocalState()).dailyReviews[0]
  assert.equal(review.saved.text, content.text)
  assert.equal(review.saved.savedAt, savedAt)
  assert.equal(review.draft.text, '未提交')
  await assert.rejects(
    x.dailyApi.saveReviewDraft({ ...(await ctx(x)), date, expectedVersion: 0, content }),
    /另一页面/,
  )
  await x.closeLocalStore()
})

test('conversion requires a real deadline, keeps identity and creates only one source of status', async () => {
  const x = setup(),
    created = await create(x, '临时成果')
  await x.dailyApi.convertToTodo({
    ...(await ctx(x)),
    entryPublicId: created.entryPublicId,
    expectedVersion: 0,
    ddl: '2040-01-01T10:00',
  })
  const state = await x.readLocalState(),
    entry = state.dayEntries[0]
  assert.equal(entry.publicId, created.entryPublicId)
  assert.equal(entry.kind, 'todo')
  assert.equal('completed' in entry, false)
  assert.equal(state.todos.length, 1)
  await x.closeLocalStore()
})

test('recurring chain completion/undo/recomplete generates the next occurrence once', async () => {
  const x = setup()
  const rule = await x.localRecurringApi.create({
    title: '循环任务',
    frequency: 'DAILY',
    dayOfWeek: null,
    dayOfMonth: null,
    triggerTime: '09:00',
    script: null,
    ddlOffsetMinutes: 60,
    enabled: true,
    chainAfterComplete: true,
  })
  await x.localRecurringApi.triggerNow(rule.id)
  const todo = (await x.readLocalState()).todos[0],
    added = await x.dailyApi.planTodo({
      ...(await ctx(x)),
      date: today(x),
      todoPublicId: todo.publicId,
    })
  for (const completed of [true, false, true]) {
    const entry = await row(x, added.entryPublicId)
    await x.dailyApi.setCompleted({
      ...(await ctx(x)),
      entryPublicId: entry.publicId,
      expectedVersion: entry.version,
      completed,
    })
  }
  const state = await x.readLocalState()
  assert.equal(state.todos.length, 2)
  assert.equal(state.recurringOccurrences.length, 2)
  assert.equal(x.projectDailyReview(state, today(x)).counts.completed, 1)
  await x.closeLocalStore()
})

test('yesterday prompt is durable but viewing it does not mark the day started', async () => {
  const x = setup(),
    date = today(x)
  await x.dailyApi.markReviewPrompt({ ...(await ctx(x)), date })
  assert.equal((await x.readLocalState()).dailyReviews[0].promptedYesterday, true)
  assert.equal(x.hasDailyActivity(await x.readLocalState(), date), false)
  await x.closeLocalStore()
  await x.initializeLocalStore()
  assert.equal((await x.readLocalState()).dailyReviews[0].promptedYesterday, true)
  await x.closeLocalStore()
})

test('an IndexedDB write failure rolls completion and its event back together', async () => {
  const x = setup(),
    created = await create(x),
    context = await ctx(x)
  const before = await x.readLocalState(),
    originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (value, key) {
    if (key === 'state') throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
    return originalPut.call(this, value, key)
  }
  try {
    await assert.rejects(
      x.dailyApi.setCompleted({
        ...context,
        entryPublicId: created.entryPublicId,
        expectedVersion: 0,
        completed: true,
      }),
      /quota failure/,
    )
  } finally {
    IDBObjectStore.prototype.put = originalPut
  }
  const after = await x.readLocalState()
  assert.equal(JSON.stringify(after), JSON.stringify(before))
  assert.equal((await row(x, created.entryPublicId)).completed, false)
  await x.closeLocalStore()
})

test('a no-op receipt prevents delayed retry from undoing a subsequent real completion', async () => {
  const x = setup(),
    created = await create(x),
    command = {
      ...(await ctx(x)),
      entryPublicId: created.entryPublicId,
      expectedVersion: 0,
      completed: false,
    }
  assert.equal((await x.dailyApi.setCompleted(command)).changed, false)
  await x.dailyApi.setCompleted({
    ...(await ctx(x)),
    entryPublicId: created.entryPublicId,
    expectedVersion: 0,
    completed: true,
  })
  assert.equal((await x.dailyApi.setCompleted(command)).changed, false)
  assert.equal((await row(x, created.entryPublicId)).completed, true)
  await x.closeLocalStore()
})
