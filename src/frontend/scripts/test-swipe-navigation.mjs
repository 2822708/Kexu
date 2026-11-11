import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/utils/swipeNavigation.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

const moduleObject = { exports: {} }
new Function('exports', 'module', compiled)(moduleObject.exports, moduleObject)
const { swipeDirection, stepIndex, routeIndex } = moduleObject.exports

test('left swipe goes next, right swipe goes previous', () => {
  assert.equal(swipeDirection(-80, 6), 1)
  assert.equal(swipeDirection(80, -6), -1)
})

test('short or mostly vertical gestures do not page', () => {
  assert.equal(swipeDirection(30, 2), 0)
  assert.equal(swipeDirection(-80, 90), 0)
  assert.equal(swipeDirection(40, 38), 0)
  assert.equal(swipeDirection(-30, 120), 0)
})

test('page stepping stops at both ends', () => {
  assert.equal(stepIndex(0, 4, 1), 1)
  assert.equal(stepIndex(3, 4, 1), null)
  assert.equal(stepIndex(0, 4, -1), null)
  assert.equal(stepIndex(2, 4, -1), 1)
})

test('current route resolves including query strings and sub paths', () => {
  const routes = ['/timetable', '/tasks', '/ai', '/settings']
  assert.equal(routeIndex('/timetable', routes), 0)
  assert.equal(routeIndex('/tasks?view=today', routes), 1)
  assert.equal(routeIndex('/tasks/history', routes), 1)
  assert.equal(routeIndex('/ai', routes), 2)
  assert.equal(routeIndex('/manual', routes), -1)
})
