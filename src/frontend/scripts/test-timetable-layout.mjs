import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name.endsWith('.css')) return {}
        if (name === 'antd') {
          return {
            Tooltip: ({ children }) => children,
            Empty: ({ description }) => React.createElement('p', null, description),
          }
        }
        if (!name.startsWith('.')) return nativeRequire(name)
        const path = new URL(`${name}.ts`, url)
        return loadSource(existsSync(path) ? path : new URL(`${name}.tsx`, url))
      },
    },
    { filename: url.pathname },
  )
  return module.exports
}

const { buildTimetableLayout, entryGridPosition } = loadSource(
  new URL('../src/utils/timetableLayout.ts', import.meta.url),
)
const TimetableGrid = loadSource(
  new URL('../src/components/TimetableGrid.tsx', import.meta.url),
).default
const periods = Array.from({ length: 6 }, (_, index) => ({
  periodNumber: index + 1,
  startTime: `${String(8 + index).padStart(2, '0')}:00:00`,
  endTime: `${String(8 + index).padStart(2, '0')}:45:00`,
  category: index < 3 ? 'MORNING' : 'AFTERNOON',
}))
const course = (id, startPeriod, endPeriod, dayOfWeek = 1) => ({
  id,
  scheduleId: 1,
  name: `课程 ${id}`,
  dayOfWeek,
  startPeriod,
  endPeriod,
  weeks: [1],
  location: null,
  teacher: null,
})
const exam = (id, startTime, endTime, examDate = '2026-10-12') => ({
  id,
  scheduleId: 1,
  name: `考试 ${id}`,
  examDate,
  startTime,
  endTime,
  location: null,
})
const layout = (courses = [], exams = [], customPeriods = periods, week = 1) =>
  buildTimetableLayout({
    courses,
    exams,
    periods: customPeriods,
    week,
    semesterStart: '2026-10-12',
  })
const keys = (entries) => Array.from(entries, (entry) => entry.key)
function assertSeparated(entries) {
  for (const a of entries)
    for (const b of entries) {
      if (a.key >= b.key || a.dayOfWeek !== b.dayOfWeek) continue
      if (a.startRow < b.endRow && b.startRow < a.endRow) {
        assert.notEqual(a.lane, b.lane, `${a.key} and ${b.key} must not occupy the same lane`)
        assert.equal(a.laneCount, b.laneCount)
      }
    }
}

test('transitive overlaps keep A1–2, B2–4 and C4–5 in their true rows and preserve Tuesday', () => {
  const result = layout([course(1, 1, 2), course(2, 2, 4), course(3, 4, 5), course(4, 1, 1, 2)])
  assert.deepEqual(keys(result.entries), ['course-1', 'course-2', 'course-3', 'course-4'])
  assert.deepEqual(
    Array.from(result.entries, (entry) => [entry.startRow, entry.endRow]),
    [
      [0, 2],
      [1, 4],
      [3, 5],
      [0, 1],
    ],
  )
  assert.equal(result.dayLaneCounts[0], 2)
  assert.equal(result.entries[2].lane, result.entries[0].lane, 'a finished lane is reused')
  assert.equal(entryGridPosition(result.entries[3]).gridColumn, 3)
  assert.equal(entryGridPosition(result.entries[3]).gridRow, '2 / 3')
  assertSeparated(result.entries)
})

test('same-start records get separate stable lanes regardless of input order', () => {
  const input = [course(10, 1, 3), course(2, 1, 3), course(3, 1, 1)]
  const a = layout(input)
  const b = layout([...input].reverse())
  assert.deepEqual(
    Array.from(a.entries, (e) => [e.key, e.lane, e.laneCount]),
    Array.from(b.entries, (e) => [e.key, e.lane, e.laneCount]),
  )
  assert.equal(a.dayLaneCounts[0], 3)
  assertSeparated(a.entries)
})

test('course and exam sharing numeric id both remain visible, including overlapping exams', () => {
  const result = layout(
    [course(1, 1, 2)],
    [exam(1, '08:30:00', '09:30:00'), exam(2, '09:00:00', '09:20:00')],
  )
  assert.equal(result.entries.length, 3)
  assert.equal(new Set(keys(result.entries)).size, 3)
  assert.equal(result.dayLaneCounts[0], 3)
  assertSeparated(result.entries)
})

test('non-overlapping groups recover full day width and exact adjacent lesson boundaries do not conflict', () => {
  const result = layout([course(1, 1, 1), course(2, 1, 2), course(3, 3, 4), course(4, 5, 6)])
  assert.equal(result.entries.find((e) => e.key === 'course-3').laneCount, 1)
  assert.equal(result.entries.find((e) => e.key === 'course-4').laneCount, 1)
  assertSeparated(result.entries)
})

test('sparse and unsorted configured period numbers use actual row indexes, without phantom rows', () => {
  const sparse = [periods[5], periods[0], periods[2], periods[4]]
  const result = layout([course(1, 1, 5), course(2, 3, 3, 2)], [], sparse)
  assert.deepEqual(
    Array.from(result.periodList, (p) => p.periodNumber),
    [1, 3, 5, 6],
  )
  assert.equal(entryGridPosition(result.entries[0]).gridRow, '2 / 5')
  assert.equal(entryGridPosition(result.entries[1]).gridRow, '3 / 4')
  assert.equal(result.occupied.has('1-3'), false, 'period 6 stays empty')
})

test('cross-category and cross-week entries do not alter the reserved cell coordinates', () => {
  const otherWeek = { ...course(9, 1, 6), weeks: [2] }
  const result = layout(
    [course(1, 2, 5), otherWeek],
    [exam(3, '08:00:00', '09:00:00', '2026-10-19')],
  )
  assert.deepEqual(keys(result.entries), ['course-1'])
  assert.equal(entryGridPosition(result.entries[0]).gridRow, '3 / 7')
  assert.equal(result.entries[0].endRow - result.entries[0].startRow, 4)
})

test('exam row matching treats class end and exam end as exclusive boundaries', () => {
  const result = layout([], [exam(1, '08:45:00', '09:45:00'), exam(2, '08:00:00', '09:00:00')])
  const a = result.entries.find((e) => e.key === 'exam-1')
  const b = result.entries.find((e) => e.key === 'exam-2')
  assert.deepEqual([a.startRow, a.endRow], [1, 2])
  assert.deepEqual([b.startRow, b.endRow], [0, 1])
  assert.equal(a.laneCount, 1)
  assert.equal(b.laneCount, 1)
})

test('before-class, break-time, after-class and removed-period records remain reachable with an honest placement note', () => {
  const result = layout(
    [course(1, 20, 20)],
    [
      exam(1, '06:00:00', '07:00:00'),
      exam(2, '08:46:00', '08:59:00'),
      exam(3, '20:00:00', '21:00:00'),
    ],
  )
  assert.equal(result.entries.length, 4)
  for (const entry of result.entries) {
    assert.ok(entry.placementNote)
    assert.ok(entry.startRow >= 0 && entry.endRow <= periods.length)
  }
  assert.equal(result.entries.find((e) => e.key === 'exam-3').exam.startTime, '20:00:00')
  assertSeparated(result.entries)
})

test('SSR exposes every overlapping item as a separately named button and positions every cell explicitly', () => {
  const name = '单节长课程名称'.repeat(12)
  const long = {
    ...course(1, 1, 1),
    name,
    location: '很长的教学楼名称'.repeat(8),
    teacher: '教师姓名'.repeat(6),
  }
  const html = renderToStaticMarkup(
    React.createElement(TimetableGrid, {
      courses: [long, course(2, 1, 3), course(3, 3, 5), course(4, 1, 1, 2)],
      exams: [exam(1, '08:00:00', '08:30:00')],
      periods,
      week: 1,
      semesterStart: '2026-10-12',
      onCourseClick() {},
      onExamClick() {},
      onEmptyClick() {},
    }),
  )
  for (const key of ['course-1', 'course-2', 'course-3', 'course-4', 'exam-1']) {
    assert.equal(html.split(`data-entry-key="${key}"`).length - 1, 1)
  }
  assert.ok(html.includes(name))
  assert.ok(html.includes(long.location))
  assert.ok(html.includes(long.teacher))
  assert.ok(html.includes('考试：考试 1，周一，08:00–08:30，查看或编辑'))
  assert.ok(html.includes('grid-column:3;grid-row:2 / 3'), 'Tuesday is explicitly anchored')
  assert.equal((html.match(/class="tt-cell tt-cell-empty/g) ?? []).length, 36)
})

test('without configured periods the grid exposes existing courses and exams as accessible fallback buttons', () => {
  const html = renderToStaticMarkup(
    React.createElement(TimetableGrid, {
      courses: [course(1, 1, 2)],
      exams: [exam(1, '08:00:00', '09:00:00')],
      periods: [],
      week: 1,
      semesterStart: '2026-10-12',
      onCourseClick() {},
      onExamClick() {},
      onEmptyClick() {},
    }),
  )
  assert.ok(html.includes('尚未配置作息时间表'))
  assert.ok(html.includes('data-entry-key="course-1"'))
  assert.ok(html.includes('data-entry-key="exam-1"'))
})
