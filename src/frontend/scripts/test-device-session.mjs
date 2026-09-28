import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/api/deviceSession.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const KEY = 'timetable.apiKey'
const DEVICE = 'timetable.deviceKey'
const DEVICE_TOKEN = `device_${'x'.repeat(43)}`
const valid = { valid: true, label: 'Test device', avatarUrl: null, role: 'USER' }

class ApiError extends Error {
  constructor(code) { super('Test request failed'); this.code = code }
}

function fixture(initial = {}, behavior = {}) {
  const storage = new Map(Object.entries(initial))
  const calls = []
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  const authApi = {
    verify: async (key) => {
      calls.push(['verify', key])
      return behavior.verify ? behavior.verify(key, storage) : valid
    },
    device: async (key) => {
      assert.equal(storage.get(DEVICE), key, 'device identity must persist before registration')
      calls.push(['device', key])
      return behavior.device ? behavior.device(key, storage) : valid
    },
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, localStorage, crypto: webcrypto,
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    navigator: behavior.locks ? { locks: { request: async (_name, callback) => callback() } } : {},
    require: (name) => {
      if (name === './index') return { authApi }
      if (name === './client') return {
        ApiError, getApiKey: () => localStorage.getItem(KEY),
        setApiKey: (key) => localStorage.setItem(KEY, key),
      }
      throw new Error(`Unexpected module: ${name}`)
    },
  })
  return { storage, calls, connect: exports.connectDevice }
}

test('new device persists a random credential before registration; concurrent calls share one attempt', async () => {
  const f = fixture({}, { locks: true })
  const first = f.connect()
  assert.equal(first, f.connect())
  await first
  const token = f.storage.get(KEY)
  assert.match(token, /^device_[A-Za-z0-9_-]{43}$/)
  assert.equal(f.storage.get(DEVICE), token)
  assert.equal(f.calls.filter(([type]) => type === 'device').length, 1)
})

test('existing legacy credentials retain their original account without registration', async () => {
  const f = fixture({ [KEY]: 'tt_existing' })
  await f.connect()
  assert.deepEqual(f.calls, [['verify', 'tt_existing']])
  assert.equal(f.storage.get(KEY), 'tt_existing')
})

test('network failure preserves existing identity and never registers a replacement', async () => {
  const f = fixture({ [KEY]: 'tt_existing' }, { verify: () => { throw new ApiError(0) } })
  await assert.rejects(f.connect())
  assert.equal(f.storage.get(KEY), 'tt_existing')
  assert.equal(f.storage.has(DEVICE), false)
  assert.equal(f.calls.length, 1)
})

test('first registration failure retries exactly the same saved device identity', async () => {
  let fail = true
  const f = fixture({}, { device: () => { if (fail) throw new ApiError(0); return valid } })
  await assert.rejects(f.connect())
  const saved = f.storage.get(DEVICE)
  assert.equal(f.storage.has(KEY), false)
  fail = false
  await f.connect()
  assert.equal(f.storage.get(KEY), saved)
  assert.deepEqual(f.calls, [['device', saved], ['device', saved]])
})

test('invalid legacy identity requests recovery without creating a device account', async () => {
  const f = fixture({ [KEY]: 'tt_existing' }, { verify: () => { throw new ApiError(401) } })
  await assert.rejects(f.connect(), /原有账户/)
  assert.equal(f.storage.get(KEY), 'tt_existing')
  assert.equal(f.calls.length, 1)
})

test('a lost server-side device identity reconnects using its existing token', async () => {
  const f = fixture({ [KEY]: DEVICE_TOKEN }, { verify: () => { throw new ApiError(401) } })
  await f.connect()
  assert.equal(f.storage.get(KEY), DEVICE_TOKEN)
  assert.deepEqual(f.calls, [['verify', DEVICE_TOKEN], ['device', DEVICE_TOKEN]])
})

test('revoked device rejection preserves the token and does not loop or replace it', async () => {
  const f = fixture({ [KEY]: DEVICE_TOKEN }, {
    verify: () => { throw new ApiError(401) },
    device: () => { throw new ApiError(401) },
  })
  await assert.rejects(f.connect())
  assert.equal(f.storage.get(KEY), DEVICE_TOKEN)
  assert.equal(f.calls.length, 2)
})

test('an old response cannot overwrite an identity changed in another tab', async () => {
  const f = fixture({}, { device: (_key, storage) => { storage.set(KEY, 'tt_other'); return valid } })
  await assert.rejects(f.connect(), /其他窗口/)
  assert.equal(f.storage.get(KEY), 'tt_other')
})
