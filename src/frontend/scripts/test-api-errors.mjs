import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/api/errors.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const moduleObject = { exports: {} }
new Function('exports', 'module', compiled)(moduleObject.exports, moduleObject)
const { classifyApiFailure, fallbackMessageForStatus } = moduleObject.exports

test('网络中断与超时可重试', () => {
  const network = classifyApiFailure({ status: 0 })
  assert.equal(network.kind, 'network')
  assert.equal(network.retryable, true)

  const timeout = classifyApiFailure({ aborted: true })
  assert.equal(timeout.kind, 'timeout')
  assert.equal(timeout.retryable, true)
})

test('5xx、408、429 归为服务端可重试', () => {
  for (const status of [500, 502, 503, 408, 429]) {
    const failure = classifyApiFailure({ status })
    assert.equal(failure.kind, 'server', String(status))
    assert.equal(failure.retryable, true, String(status))
  }
})

test('401 归为登录失效，403 归为权限不足，均不自动重试', () => {
  const auth = classifyApiFailure({ status: 401 })
  assert.equal(auth.kind, 'auth')
  assert.equal(auth.retryable, false)

  const forbidden = classifyApiFailure({ status: 403 })
  assert.equal(forbidden.kind, 'forbidden')
  assert.equal(forbidden.retryable, false)
  assert.match(forbidden.message, /没有执行该操作的权限/)
})

test('4xx 业务错误保留原始文案', () => {
  const failure = classifyApiFailure({ status: 422, message: '结束时间必须晚于开始时间' })
  assert.equal(failure.kind, 'client')
  assert.equal(failure.retryable, false)
  assert.equal(failure.message, '结束时间必须晚于开始时间')
})

test('非 JSON 的 5xx 响应使用统一可读文案', () => {
  assert.match(fallbackMessageForStatus(502), /暂时不可用/)
  assert.match(fallbackMessageForStatus(500), /暂时不可用/)
  assert.equal(fallbackMessageForStatus(404), '请求失败 (HTTP 404)')
})
