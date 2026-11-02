import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/app-mode.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const moduleObject = { exports: {} }
new Function('exports', 'module', compiled)(moduleObject.exports, moduleObject)
const { resolveAppMode, assertBuildMode } = moduleObject.exports

test('打包外壳与 PWA 始终使用本地模式', () => {
  for (const mode of ['shell', 'mobile']) {
    const info = resolveAppMode({ viteMode: mode })
    assert.equal(info.id, 'local', mode)
    assert.equal(info.needsBackend, false, mode)
  }
  assert.equal(resolveAppMode({ viteMode: 'shell' }).source, 'shell')
  assert.equal(resolveAppMode({ viteMode: 'mobile' }).source, 'mobile')
})

test('开发与普通构建默认需要后端', () => {
  for (const mode of ['development', 'production', undefined]) {
    const info = resolveAppMode({ viteMode: mode })
    assert.equal(info.id, 'server', String(mode))
    assert.equal(info.needsBackend, true, String(mode))
    assert.ok(info.hint.includes('mvnw'), '提示应包含启动后端的命令')
  }
})

test('本地模式标记可以不依赖构建模式生效', () => {
  assert.equal(resolveAppMode({ viteMode: 'localdata' }).id, 'local')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: 'true' }).id, 'local')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: 'TRUE' }).id, 'local')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: '1' }).id, 'local')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: 'yes' }).id, 'local')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: 'false' }).id, 'server')
  assert.equal(resolveAppMode({ viteMode: 'development', localData: '0' }).id, 'server')
})

test('服务器模式构建禁止指向本机开发地址', () => {
  for (const base of ['http://localhost:8080/api', 'https://127.0.0.1:8443', 'http://0.0.0.0:8080', 'http://[::1]:8080', 'https://api.localhost']) {
    assert.ok(assertBuildMode({ viteMode: 'production', apiBase: base }), base)
  }
  assert.equal(assertBuildMode({ viteMode: 'production', apiBase: '/api' }), null)
  assert.equal(assertBuildMode({ viteMode: 'production', apiBase: 'https://kexu.example.com/api' }), null)
  // 本地模式的产物不受该断言影响。
  assert.equal(assertBuildMode({ viteMode: 'mobile', apiBase: 'http://localhost:8080/api' }), null)
})

test('普通网页构建不允许被 VITE_LOCAL_DATA 静默改成本地模式', () => {
  const problem = assertBuildMode({ viteMode: 'production', localData: 'true' })
  assert.ok(problem && problem.includes('build:localdata'), String(problem))
  // 显式声明的本地构建不受影响。
  assert.equal(assertBuildMode({ viteMode: 'localdata', localData: 'true' }), null)
  assert.equal(assertBuildMode({ viteMode: 'mobile' }), null)
  assert.equal(assertBuildMode({ viteMode: 'shell' }), null)
})
