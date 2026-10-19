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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      require: (name) =>
        name.startsWith('.') ? loadSource(new URL(`${name}.ts`, url)) : nativeRequire(name),
    },
    { filename: url.pathname },
  )
  return module.exports
}

const { dayAgenda, courseClockTime } = loadSource(
  new URL('../src/utils/dayAgenda.ts', import.meta.url),
)
const schedule = { periodStartDate: '2026-09-02', periodEndDate: '2026-09-16' }
const course = (id, dayOfWeek, weeks = [1, 2, 3], startPeriod = 1, endPeriod = 2) => ({
  id,
  name: `Course ${id}`,
  scheduleId: 1,
  dayOfWeek,
  weeks,
  startPeriod,
  endPeriod,
  teacher: null,
  location: null,
})
const exam = (id, examDate, startTime = '09:00:00') => ({
  id,
  scheduleId: 1,
  name: `Exam ${id}`,
  examDate,
  startTime,
  endTime: '11:00:00',
  location: null,
})
const ids = (items) => Array.from(items, (item) => item.id)

test('a term starting Wednesday uses ISO week 1 and does not leak Monday courses before its start', () => {
  const before = dayAgenda('2026-08-31', schedule, [course(1, 1)], [])
  assert.equal(before.status, 'before-term')
  assert.equal(before.week, 1)
  assert.equal(before.dayOfWeek, 1)
  assert.deepEqual(ids(before.courses), [])
  const first = dayAgenda(
    '2026-09-02',
    schedule,
    [course(1, 3, [1]), course(2, 3, [2]), course(3, 4)],
    [],
  )
  assert.equal(first.status, 'in-term')
  assert.equal(first.week, 1)
  assert.deepEqual(ids(first.courses), [1])
})

test('Sunday is day 7 and Monday advances the teaching week for odd and even week selection', () => {
  const sunday = dayAgenda('2026-09-06', schedule, [course(1, 7, [1]), course(2, 1, [1])], [])
  assert.equal(sunday.dayOfWeek, 7)
  assert.deepEqual(ids(sunday.courses), [1])
  const monday = dayAgenda('2026-09-07', schedule, [course(1, 1, [1, 3]), course(2, 1, [2])], [])
  assert.equal(monday.week, 2)
  assert.deepEqual(ids(monday.courses), [2])
})

test('last actual term day remains included and the rest of its ISO week has no courses', () => {
  const last = dayAgenda('2026-09-16', schedule, [course(1, 3, [3])], [])
  assert.equal(last.status, 'in-term')
  assert.deepEqual(ids(last.courses), [1])
  const after = dayAgenda('2026-09-17', schedule, [course(2, 4, [3])], [])
  assert.equal(after.week, 3)
  assert.equal(after.status, 'after-term')
  assert.deepEqual(ids(after.courses), [])
})

test('day cards keep overlapping courses and sort by period then stable id', () => {
  const result = dayAgenda(
    '2026-09-02',
    schedule,
    [course(8, 3, [1], 5, 6), course(3, 3), course(2, 3)],
    [],
  )
  assert.deepEqual(ids(result.courses), [2, 3, 8])
})

test('exact-date exams are sorted and remain visible after the course term', () => {
  const result = dayAgenda(
    '2026-09-17',
    schedule,
    [],
    [exam(3, '2026-09-16'), exam(2, '2026-09-17', '13:00:00'), exam(1, '2026-09-17')],
  )
  assert.equal(result.status, 'after-term')
  assert.deepEqual(ids(result.exams), [1, 2])
})

test('invalid dates do not silently roll into another month or show a course', () => {
  const result = dayAgenda('2026-02-30', schedule, [course(1, 1)], [])
  assert.equal(result.status, 'invalid')
  assert.equal(result.week, null)
  assert.deepEqual(ids(result.courses), [])
  assert.deepEqual(ids(result.exams), [])
})

test('period clock range uses the configured end period without inventing missing settings', () => {
  const lesson = course(1, 3, [1], 1, 2)
  const periods = [
    { periodNumber: 2, startTime: '09:00:00', endTime: '09:45:00' },
    { periodNumber: 1, startTime: '08:00:00', endTime: '08:45:00' },
  ]
  assert.equal(courseClockTime(lesson, periods), '08:00–09:45')
  assert.equal(courseClockTime(lesson, periods.slice(1)), null)
})
