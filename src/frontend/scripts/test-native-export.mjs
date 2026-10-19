import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/platform/saveJson.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function setup({ native = true, kind = 'android', origin = 'https://appassets.androidplatform.net' } = {}) {
  const requests = [], timers = new Map(), listeners = new Set(), anchors = [], revoked = []
  let timerId = 0
  const android = { postMessage(message) { requests.push(JSON.parse(message)) } }
  const windows = { postMessage(message) { requests.push(message) }, addEventListener(_type, callback) { listeners.add(callback) }, removeEventListener(_type, callback) { listeners.delete(callback) } }
  const window = { location: { origin }, ...(kind === 'android' ? { KexuNative: android } : kind === 'windows' ? { chrome: { webview: windows } } : {}) }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: () => ({ NATIVE_SHELL: native }), window,
    crypto: webcrypto, TextEncoder, Blob,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: (url) => revoked.push(url) },
    document: { createElement: () => { const anchor = { click() { this.clicked = true } }; anchors.push(anchor); return anchor } },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id }, clearTimeout(id) { timers.delete(id) },
  })
  return { ...module.exports, requests, timers, listeners, anchors, revoked, reply(reply) { const event = { data: JSON.stringify(reply) }; if (kind === 'android') android.onmessage?.(event); else for (const callback of listeners) callback(event) } }
}
test('Android narrow channel waits for confirmed save and sends only bounded JSON fields', async () => {
  const x = setup(), promise = x.saveJsonFile({ title: '临时事项', secret: 'local-only-fixture' }, 'Tangent-core.json')
  assert.equal(x.requests.length, 1)
  assert.deepEqual(Object.keys(x.requests[0]).sort(), ['filename', 'id', 'text', 'type'])
  assert.equal(x.requests[0].type, 'save-json')
  assert.equal(JSON.parse(x.requests[0].text).title, '临时事项')
  x.reply({ type: 'save-json-result', id: x.requests[0].id, ok: true })
  assert.equal(await promise, true)
  assert.equal(x.timers.size, 0)
})
test('Windows channel handles cancel without marking a credential exported', async () => {
  const x = setup({ kind: 'windows' }), promise = x.saveJsonFile({ fixture: true }, 'Tangent-private-recovery.json')
  x.reply({ type: 'save-json-result', id: x.requests[0].id, ok: false, cancelled: true })
  assert.equal(await promise, false)
  assert.equal(x.listeners.size, 0)
})
test('unknown reply IDs cannot settle an export and duplicate requests are rejected', async () => {
  const x = setup(), promise = x.saveJsonFile({}, 'core.json')
  x.reply({ type: 'save-json-result', id: webcrypto.randomUUID(), ok: true })
  assert.equal(x.timers.size, 1)
  await assert.rejects(x.saveJsonFile({}, 'other.json'), /当前保存窗口/)
  x.reply({ type: 'save-json-result', id: x.requests[0].id, ok: true })
  assert.equal(await promise, true)
})
test('native save failure preserves the caller failure rather than reporting success', async () => {
  const x = setup(), promise = x.saveJsonFile({}, 'core.json')
  x.reply({ type: 'save-json-result', id: x.requests[0].id, ok: false, error: '存储空间不足' })
  await assert.rejects(promise, /存储空间不足/)
  assert.equal(x.timers.size, 0)
})
test('shell refuses a foreign origin and unavailable native APIs without silent blob fallback', async () => {
  const foreign = setup({ origin: 'https://example.com' })
  await assert.rejects(foreign.saveJsonFile({}, 'core.json'), /应用地址不正确/)
  const absent = setup({ kind: 'none' })
  await assert.rejects(absent.saveJsonFile({}, 'core.json'), /系统 WebView/)
  assert.equal(foreign.requests.length + absent.anchors.length, 0)
})
test('filenames and UTF8 size are validated before any native call', async () => {
  const x = setup()
  for (const name of ['../core.json', 'C:\\core.json', 'CON.json', 'file.exe']) await assert.rejects(x.saveJsonFile({}, name), /文件名/)
  await assert.rejects(x.saveJsonFile({ text: '汉'.repeat(4 * 1024 * 1024) }, 'core.json'), /11MB/)
  assert.equal(x.requests.length, 0)
})
test('export timeout clears the request so later explicit exports remain possible', async () => {
  const x = setup(), promise = x.saveJsonFile({}, 'core.json')
  const timer = [...x.timers.values()][0]; timer()
  await assert.rejects(promise, /超时/)
  const next = x.saveJsonFile({}, 'next.json')
  x.reply({ type: 'save-json-result', id: x.requests[1].id, ok: true })
  assert.equal(await next, true)
})
test('ordinary PWA export keeps its browser download behavior', async () => {
  const x = setup({ native: false, kind: 'none', origin: 'https://timetable.example.com' })
  assert.equal(await x.saveJsonFile({ ok: true }, 'core.json'), true)
  assert.equal(x.anchors[0].clicked, true)
  assert.equal(x.anchors[0].download, 'core.json')
  assert.equal(x.requests.length, 0)
  for (const callback of x.timers.values()) callback()
  assert.deepEqual(x.revoked, ['blob:fixture'])
})
