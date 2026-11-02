import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function load(needsBackend) {
  const source = readFileSync(new URL('../src/api/connectionDiagnostics.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleObject = { exports: {} }
  const stubRequire = (id) => {
    if (id === '../local/mode') return { APP_MODE: { needsBackend } }
    throw new Error(`unexpected require: ${id}`)
  }
  new Function('exports', 'module', 'require', compiled)(moduleObject.exports, moduleObject, stubRequire)
  return moduleObject.exports
}

const app = load(true)

test('只有网络/超时/服务端失败才追加排查步骤', () => {
  for (const kind of ['network', 'timeout', 'server']) {
    const text = app.describeConnectionFailure(Object.assign(new Error('boom'), { kind }), '/api')
    assert.match(text, /请求地址：\/api/, kind)
    assert.match(text, /mvnw/, kind)
  }
})

test('凭据与权限错误保留原文案，不引导改用本地模式', () => {
  for (const kind of ['auth', 'client', 'unknown']) {
    const text = app.describeConnectionFailure(
      Object.assign(new Error('原有账户连接已失效，请联系管理员恢复'), { kind }),
      '/api',
    )
    assert.equal(text, '原有账户连接已失效，请联系管理员恢复', kind)
    assert.doesNotMatch(text, /dev:local/, kind)
  }
})

test('普通 Error 不被误判为后端未启动', () => {
  const text = app.describeConnectionFailure(new Error('本机连接未获授权'), '/api')
  assert.equal(text, '本机连接未获授权')
})

test('本地模式保持原始错误', () => {
  const local = load(false)
  const text = local.describeConnectionFailure(
    Object.assign(new Error('boom'), { kind: 'network' }),
    '/api',
  )
  assert.equal(text, 'boom')
})
