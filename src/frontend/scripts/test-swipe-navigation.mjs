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
const { classifySwipeStart, shouldCommitSwipe, stepIndex, routeIndex } = moduleObject.exports

test('a gesture starts a horizontal drag or yields to vertical scrolling', () => {
  assert.equal(classifySwipeStart(7, 0), 'pending')
  assert.equal(classifySwipeStart(-8, 0), 'horizontal')
  assert.equal(classifySwipeStart(10, 12), 'pending')
  assert.equal(classifySwipeStart(10, 13), 'vertical')
  assert.equal(classifySwipeStart(-24, 20), 'horizontal')
  assert.equal(classifySwipeStart(23, -20), 'vertical')
})

test('release commits only above the width-based threshold capped at 72 pixels', () => {
  assert.equal(shouldCommitSwipe(30, 320), false)
  assert.equal(shouldCommitSwipe(-58, 320), true)
  assert.equal(shouldCommitSwipe(-72, 500), false)
  assert.equal(shouldCommitSwipe(73, 500), true)
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
