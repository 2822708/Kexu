import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const nativeRequire = createRequire(import.meta.url)
const modules = new Map()
function loadSource(url) {
  if (modules.has(url.href)) return modules.get(url.href)
  const module = { exports: {} }
  modules.set(url.href, module.exports)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      Intl,
      Date,
      require: (name) =>
        name.startsWith('.') ? loadSource(new URL(`${name}.ts`, url)) : nativeRequire(name),
    },
    { filename: url.pathname },
  )
  return module.exports
}

const { projectDailyReview, dailyReviewStatus } = loadSource(
  new URL('../src/local/daily/review.ts', import.meta.url),
)
const { resolveDailyEntries, hasDailyActivity, hasDailyReviewMaterial, dailyBusinessDate } =
  loadSource(new URL('../src/local/daily/selectors.ts', import.meta.url))
const TODAY = '2026-10-19'
const YESTERDAY = '2026-10-18'
const stamp = `${TODAY}T02:00:00.000Z`
const state = () => ({
  dayEntries: [],
  dailyEvents: [],
  dailyReviews: [],
  todos: [],
  courses: [],
  focusCompletions: [],
  conversations: [],
  revision: 1,
})
const entry = (publicId, more = {}) => ({
  publicId,
  kind: 'dayTask',
  title: publicId,
  titleSnapshot: publicId,
  plannedDate: TODAY,
  initialDate: TODAY,
  origin: 'planned',
  position: 0,
  isPriority: false,
  version: 1,
  completed: false,
  ...more,
})
let eventId = 0
const event = (targetPublicId, more = {}) => ({
  publicId: `event-${++eventId}`,
  operationId: `op-${eventId}`,
  kind: 'complete',
  targetKind: 'dayTask',
  targetPublicId,
  entryPublicId: targetPublicId,
  attributedDate: TODAY,
  recordedAt: stamp,
  occurredAt: stamp,
  source: 'manual',
  titleSnapshot: targetPublicId,
  origin: 'planned',
  fromDate: null,
  toDate: null,
  previousEventId: null,
  targetVersion: eventId,
  ...more,
})
const normal = (value) => JSON.parse(JSON.stringify(value))

test('unknown legacy completion and recently edited updatedAt cannot become today achievements', () => {
  const s = state()
  s.dayEntries.push(entry('old', { completed: true, updatedAt: stamp }))
  s.todos.push({ publicId: 'old-todo', completed: true, updatedAt: stamp, examId: null })
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.completed, 0)
  assert.equal(hasDailyActivity(s, TODAY), false)
  assert.equal(f.summary.includes('0分'), false)
})

test('complete undo and redo count one currently valid target, not three operations', () => {
  const s = state()
  s.dayEntries.push(entry('a', { completed: true, isPriority: true }))
  s.dailyEvents.push(event('a'), event('a', { kind: 'undo' }), event('a'))
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.completed, 1)
  assert.equal(f.counts.priorityCompleted, 1)
  assert.deepEqual(normal(f.completedTitles), ['a'])
  s.dailyEvents.push(event('a', { kind: 'undo' }))
  s.dayEntries[0].completed = false
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
  assert.equal(hasDailyActivity(s, TODAY), true)
})

test('latest serialized operation wins even when a device clock moved backwards', () => {
  const s = state()
  s.dayEntries.push(entry('a', { completed: false }))
  s.dailyEvents.push(
    event('a', { recordedAt: '2026-10-19T12:00:00Z' }),
    event('a', { kind: 'undo', recordedAt: '2026-10-19T01:00:00Z' }),
  )
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
})

test('same referenced todo on multiple days has one state and one attributed completion', () => {
  const s = state()
  s.todos.push({
    publicId: 't',
    title: '报告',
    completed: true,
    examId: null,
    dailyVersion: 5,
    ddl: '2026-10-20T20:00',
  })
  s.dayEntries.push(
    entry('r1', { kind: 'todo', todoPublicId: 't', plannedDate: YESTERDAY }),
    entry('r2', { kind: 'todo', todoPublicId: 't' }),
  )
  s.dailyEvents.push(
    event('t', { targetKind: 'todo', attributedDate: YESTERDAY, entryPublicId: 'r1' }),
  )
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
  assert.equal(projectDailyReview(s, YESTERDAY).counts.completed, 1)
  const row = resolveDailyEntries(s, TODAY)[0]
  assert.equal(row.completedDate, YESTERDAY)
  assert.equal(row.version, 5)
})

test('system exams and undo then automatic completion do not become manual achievements', () => {
  const s = state()
  s.todos.push(
    { publicId: 'exam', completed: true, examId: 1 },
    { publicId: 'a', completed: true, examId: null },
  )
  s.dailyEvents.push(
    event('exam', { targetKind: 'todo', source: 'system' }),
    event('a', { targetKind: 'todo' }),
    event('a', { targetKind: 'todo', kind: 'undo' }),
  )
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
})

test('manual courses are separate facts and keyed by the concrete occurrence date', () => {
  const s = state()
  s.dailyEvents.push(
    event('math', { targetKind: 'course', kind: 'courseComplete', attributedDate: YESTERDAY }),
    event('math', { targetKind: 'course', kind: 'courseComplete' }),
  )
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.completed, 0)
  assert.equal(f.counts.coursesConfirmed, 1)
  assert.equal(projectDailyReview(s, YESTERDAY).counts.coursesConfirmed, 1)
  s.dailyEvents.push(event('math', { targetKind: 'course', kind: 'courseUndo' }))
  assert.equal(projectDailyReview(s, TODAY).counts.coursesConfirmed, 0)
})

test('backfill belongs only to its attributed day and is a subset of ad hoc total', () => {
  const s = state()
  s.dayEntries.push(entry('water', { completed: true, origin: 'backfill', plannedDate: YESTERDAY }))
  s.dailyEvents.push(
    event('water', {
      source: 'backfill',
      origin: 'backfill',
      attributedDate: YESTERDAY,
      occurredAt: null,
    }),
  )
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
  const f = projectDailyReview(s, YESTERDAY)
  assert.equal(f.counts.completed, 1)
  assert.equal(f.counts.adHocCompleted, 1)
  assert.equal(f.counts.backfillCompleted, 1)
  assert.equal(hasDailyReviewMaterial(s, YESTERDAY), true)
})

test('prearranged future tasks do not count as starting that future day', () => {
  const s = state()
  s.dailyEvents.push(event('future', { kind: 'plan', attributedDate: '2026-10-20' }))
  assert.equal(hasDailyActivity(s, '2026-10-20'), false)
  assert.equal(hasDailyReviewMaterial(s, '2026-10-20'), false)
  assert.equal(hasDailyActivity(s, TODAY), true)
})

test('opening or dismissing yesterday prompt is not meaningful daily activity', () => {
  const s = state()
  s.dailyEvents.push(event('review', { kind: 'reviewPrompt', targetKind: 'review' }))
  s.dailyReviews.push({ date: TODAY, promptedYesterday: true, saved: null, draft: null })
  assert.equal(hasDailyActivity(s, TODAY), false)
  s.dailyReviews[0].draft = { feeling: '有点累', text: '', nextStep: '', updatedAt: stamp }
  assert.equal(hasDailyActivity(s, TODAY), true)
})

test('deleted sources retain truthful archived completion titles', () => {
  const s = state()
  s.dailyEvents.push(event('removed', { targetKind: 'todo', titleSnapshot: '已交的报告' }))
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.completed, 1)
  assert.deepEqual(normal(f.completedTitles), ['已交的报告'])
  s.dayEntries.push(
    entry('orphan', { kind: 'todo', todoPublicId: 'removed', titleSnapshot: '已交的报告' }),
  )
  assert.equal(resolveDailyEntries(s, TODAY)[0].missingSource, true)
  assert.equal(projectDailyReview(s, TODAY).counts.remaining, 0)
})

test('unrelated chat and future-day edits leave the factual fingerprint stable', () => {
  const s = state()
  s.dayEntries.push(entry('a', { completed: true }))
  s.dailyEvents.push(event('a'))
  const before = projectDailyReview(s, TODAY).fingerprint
  s.revision++
  s.conversations.push({ id: 1, title: 'hello' })
  s.dailyEvents.push(event('b', { kind: 'plan', attributedDate: '2026-10-20' }))
  assert.equal(projectDailyReview(s, TODAY).fingerprint, before)
})

test('saved facts stay unchanged, dirty status is explicit, and drafts do not replace saved writing', () => {
  const s = state()
  const initial = projectDailyReview(s, TODAY)
  const saved = {
    feeling: '很充实',
    text: '先写一句',
    nextStep: '',
    savedAt: stamp,
    fingerprint: initial.fingerprint,
    summary: initial.summary,
    facts: initial.counts,
    algorithmVersion: initial.algorithmVersion,
  }
  s.dailyReviews.push({ date: TODAY, saved, draft: null })
  assert.equal(dailyReviewStatus(s, TODAY), '已保存回顾')
  s.dayEntries.push(entry('a', { completed: true }))
  s.dailyEvents.push(event('a'))
  assert.match(dailyReviewStatus(s, TODAY), /事实有更新/)
  s.dailyReviews[0].draft = { feeling: '有点累', text: '草稿', nextStep: '', updatedAt: stamp }
  assert.match(dailyReviewStatus(s, TODAY), /有未保存草稿/)
  assert.equal(saved.text, '先写一句')
  assert.equal(saved.fingerprint, initial.fingerprint)
})

test('Shanghai midnight boundary never uses the device timezone', () => {
  assert.equal(dailyBusinessDate('2026-10-18T15:59:59Z'), YESTERDAY)
  assert.equal(dailyBusinessDate('2026-10-18T16:00:00Z'), TODAY)
  assert.equal(dailyBusinessDate('invalid'), '')
})

test('moving a task removes it from today remaining without pretending it completed', () => {
  const s = state()
  s.dayEntries.push(entry('a', { plannedDate: '2026-10-20' }))
  s.dailyEvents.push(event('a', { kind: 'move', fromDate: TODAY, toDate: '2026-10-20' }))
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.completed, 0)
  assert.equal(f.counts.remaining, 0)
  assert.equal(f.counts.movedOut, 1)
})

test('deselecting and moving a priority retain its original commitment denominator', () => {
  const s = state()
  s.dayEntries.push(
    entry('a', { completed: true, isPriority: true }),
    entry('b', { completed: true, isPriority: true }),
    entry('c', { plannedDate: '2026-10-20', isPriority: false }),
  )
  s.dailyEvents.push(
    event('a', { priorityAfter: true }),
    event('b', { priorityAfter: true }),
    event('c', { kind: 'priority', priorityBefore: false, priorityAfter: true }),
    event('c', { kind: 'priority', priorityBefore: true, priorityAfter: false }),
    event('c', {
      kind: 'move',
      fromDate: TODAY,
      toDate: '2026-10-20',
      priorityBefore: false,
      priorityAfter: false,
    }),
  )
  const f = projectDailyReview(s, TODAY)
  assert.equal(f.counts.priorityPlanned, 3)
  assert.equal(f.counts.priorityCompleted, 2)
  assert.equal(f.counts.priorityAdjusted, 1)
  assert.match(f.summary, /已调整1项/)
  assert.equal(projectDailyReview(s, '2026-10-20').counts.priorityPlanned, 0)
})

test('legacy priority events without an explicit flag cannot invent selected commitments', () => {
  const s = state()
  s.dayEntries.push(entry('a'))
  s.dailyEvents.push(event('a', { kind: 'priority' }))
  assert.equal(projectDailyReview(s, TODAY).counts.priorityPlanned, 0)
})

test('external undo followed by source deletion does not resurrect an archived completion', () => {
  const s = state()
  s.dailyEvents.push(
    event('todo-a', { targetKind: 'todo' }),
    event('todo-a', { targetKind: 'todo', kind: 'undo', entryPublicId: null }),
  )
  assert.equal(projectDailyReview(s, TODAY).counts.completed, 0)
})

test('automatic exam maintenance cannot mark an unrelated saved review as stale', () => {
  const s = state()
  s.todos.push({ publicId: 'exam', completed: false, examId: 12 })
  s.dayEntries.push(entry('exam-ref', { kind: 'todo', todoPublicId: 'exam' }))
  const before = projectDailyReview(s, TODAY).fingerprint
  s.todos[0].completed = true
  s.dailyEvents.push(event('exam', { targetKind: 'todo', source: 'system' }))
  assert.equal(projectDailyReview(s, TODAY).fingerprint, before)
})
