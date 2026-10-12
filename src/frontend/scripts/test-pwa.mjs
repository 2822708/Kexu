import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/pwa/serviceWorkerSource.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const exported = {}
vm.runInNewContext(compiled, { exports: exported })
const { createServiceWorkerSource } = exported
const updateExports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('../src/pwa/updateState.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: updateExports },
)
const { findWaitingUpdate } = updateExports
const origin = 'https://timetable.example'

function fixture({ base = '/', version = 'v2', offline = false, cacheControl = '' } = {}) {
  const events = new Map()
  const storage = new Map()
  const fetches = []
  const precached = []
  let skipWaitingCalls = 0
  let claims = 0
  const open = async (name) => {
    if (!storage.has(name)) storage.set(name, new Map())
    const contents = storage.get(name)
    const path = (request) =>
      new URL(typeof request === 'string' ? request : request.url, origin).pathname
    return {
      addAll: async (requests) => {
        for (const request of requests) {
          precached.push(request)
          contents.set(
            path(request),
            new Response('cached shell', { headers: { 'Content-Type': 'text/html' } }),
          )
        }
      },
      match: async (request) => contents.get(path(request))?.clone(),
      put: async (request, response) => contents.set(path(request), response.clone()),
    }
  }
  const caches = {
    open,
    keys: async () => [...storage.keys()],
    delete: async (name) => storage.delete(name),
    match: async (request, { cacheName }) => (await open(cacheName)).match(request),
  }
  const self = {
    location: { origin },
    clients: {
      claim: async () => {
        claims++
      },
    },
    skipWaiting: async () => {
      skipWaitingCalls++
    },
    addEventListener: (name, handler) => events.set(name, handler),
  }
  function ScopedRequest(url, options) {
    return new Request(new URL(url, origin), options)
  }
  vm.runInNewContext(
    createServiceWorkerSource({
      version,
      base,
      precache: [`${base}index.html`, `${base}assets/app-123.js`],
      assets: [`${base}index.html`, `${base}assets/app-123.js`, `${base}assets/lazy-456.js`],
    }),
    {
      self,
      caches,
      Request: ScopedRequest,
      Response,
      URL,
      fetch: async (request) => {
        fetches.push(request)
        if (offline) throw new Error('Offline')
        const response = new Response('network response', {
          headers: { 'Cache-Control': cacheControl },
        })
        Object.defineProperty(response, 'type', { value: 'basic' })
        return response
      },
    },
  )
  const lifetime = async (name, data = {}) => {
    const jobs = []
    events.get(name)({ ...data, waitUntil: (promise) => jobs.push(promise) })
    await Promise.all(jobs)
  }
  const request = async (
    path,
    { method = 'GET', mode = 'cors', headers = {}, absolute = false } = {},
  ) => {
    let response
    events.get('fetch')({
      request: {
        url: absolute ? path : new URL(path, origin).href,
        method,
        mode,
        headers: new Headers(headers),
      },
      respondWith: (promise) => {
        response = promise
      },
    })
    return response ? { intercepted: true, response: await response } : { intercepted: false }
  }
  return {
    lifetime,
    request,
    storage,
    precached,
    fetches,
    skipWaitingCalls: () => skipWaitingCalls,
    claims: () => claims,
  }
}

test('API, authentication, AI/SSE, backups, mutations and identity queries bypass the worker entirely', async () => {
  const f = fixture()
  for (const path of [
    '/api/schedules',
    '/api/ai/messages/stream',
    '/auth/device',
    '/ai/status',
    '/backups/file',
    '/backup/file',
    '/widget?key=secret',
    '/assets/app-123.js?token=secret',
  ]) {
    assert.equal((await f.request(path, { mode: 'navigate' })).intercepted, false, path)
  }
  assert.equal(
    (await f.request('/assets/app-123.js', { headers: { 'X-API-Key': 'private' } })).intercepted,
    false,
  )
  assert.equal(
    (await f.request('/assets/app-123.js', { headers: { Authorization: 'Bearer private' } }))
      .intercepted,
    false,
  )
  assert.equal((await f.request('/api/todos', { method: 'POST' })).intercepted, false)
  assert.equal(
    (await f.request('https://external.example/assets/app-123.js', { absolute: true })).intercepted,
    false,
  )
  assert.equal(f.storage.size, 0)
  assert.equal(f.fetches.length, 0)
})

test('only exact static build assets are cached; hashed chunks reuse the cached response', async () => {
  const f = fixture()
  assert.equal((await f.request('/uploads/report.pdf')).intercepted, false)
  assert.equal((await f.request('/export.json')).intercepted, false)
  assert.equal((await f.request('/assets/fake.js')).intercepted, false)
  assert.equal(await (await f.request('/assets/lazy-456.js')).response.text(), 'network response')
  assert.equal(await (await f.request('/assets/lazy-456.js')).response.text(), 'network response')
  assert.equal(f.fetches.length, 1)
})

test('private/no-store static responses are never stored', async () => {
  for (const cacheControl of ['private', 'no-store']) {
    const f = fixture({ cacheControl })
    await f.request('/assets/lazy-456.js')
    await f.request('/assets/lazy-456.js')
    assert.equal(f.fetches.length, 2)
  }
})

test('offline navigation opens only the precached shell, not a cached business response', async () => {
  const f = fixture({ offline: true })
  await f.lifetime('install')
  const result = await f.request('/todos', { mode: 'navigate' })
  assert.equal(await result.response.text(), 'cached shell')
  assert.equal((await f.request('/api/todos', { mode: 'navigate' })).intercepted, false)
  assert.equal(f.skipWaitingCalls(), 0)
  assert.ok(
    f.precached.every((request) => request.credentials === 'omit' && request.cache === 'reload'),
  )
})

test('online navigation responses are never put into cache', async () => {
  const f = fixture()
  const result = await f.request('/todos', { mode: 'navigate' })
  assert.equal(await result.response.text(), 'network response')
  assert.equal(f.storage.size, 0)
})

test('updates wait for an explicit saved-update command and clean only their own shell caches', async () => {
  const f = fixture()
  f.storage.set('tangent-mobile-shell-/-v1', new Map())
  f.storage.set('unrelated-cache', new Map())
  await f.lifetime('install')
  assert.equal(f.skipWaitingCalls(), 0)
  await f.lifetime('message', { data: { type: 'OTHER' } })
  assert.equal(f.skipWaitingCalls(), 0)
  await f.lifetime('message', { data: { type: 'ACTIVATE_SAVED_UPDATE' } })
  assert.equal(f.skipWaitingCalls(), 1)
  await f.lifetime('activate')
  assert.equal(f.claims(), 1)
  assert.equal(f.storage.has('tangent-mobile-shell-/-v1'), false)
  assert.equal(f.storage.has('unrelated-cache'), true)
})

test('subpath deployments protect their API prefix and ignore resources outside the scope', async () => {
  const f = fixture({ base: '/timetable/' })
  assert.equal((await f.request('/timetable/api/todos', { mode: 'navigate' })).intercepted, false)
  assert.equal((await f.request('/api/todos', { mode: 'navigate' })).intercepted, false)
  assert.equal((await f.request('/timetable/assets/lazy-456.js')).intercepted, true)
})

test('the claimed new worker serves an already cached old lazy chunk while keeping only one completed old build', async () => {
  const f = fixture({ offline: true })
  const oldPath = '/assets/TodosPage-oldAbC12.js'
  f.storage.set(
    'tangent-mobile-shell-/-v0',
    new Map([['/index.html', new Response('older shell')]]),
  )
  f.storage.set(
    'tangent-mobile-shell-/-v1',
    new Map([
      ['/index.html', new Response('previous shell')],
      [oldPath, new Response('old lazy chunk')],
      ['/api/todos', new Response('never expose business data')],
    ]),
  )
  // A newer failed installation must not displace the usable previous version.
  f.storage.set('tangent-mobile-shell-/-failed', new Map())
  await f.lifetime('install')
  await f.lifetime('activate')
  assert.equal(f.claims(), 1)
  assert.equal(f.storage.has('tangent-mobile-shell-/-v0'), false)
  assert.equal(f.storage.has('tangent-mobile-shell-/-failed'), false)
  assert.equal(f.storage.has('tangent-mobile-shell-/-v1'), true)
  assert.equal(await (await f.request(oldPath)).response.text(), 'old lazy chunk')
  assert.equal(f.fetches.length, 0)
  assert.equal((await f.request('/api/todos')).intercepted, false)
  assert.equal((await f.request(`${oldPath}?key=private`)).intercepted, false)
  assert.equal(
    (await f.request(oldPath, { headers: { 'X-API-Key': 'private' } })).intercepted,
    false,
  )
  assert.equal(f.storage.get('tangent-mobile-shell-/-v2').has(oldPath), false)
})

test('an unknown hashed asset is passed to the network and never added to any cache', async () => {
  const f = fixture()
  await f.lifetime('install')
  await f.lifetime('activate')
  const unknown = '/assets/Unknown-AbCd1234.js'
  await f.request(unknown)
  await f.request(unknown)
  assert.equal(f.fetches.length, 2)
  assert.ok([...f.storage.values()].every((entries) => !entries.has(unknown)))
  assert.equal((await f.request('/exports/Unknown-AbCd1234.js')).intercepted, false)
})

test('a newer waiting install does not evict the previously activated build still used by old tabs', async () => {
  const f = fixture({ version: 'v3', offline: true })
  const oldPath = '/assets/SettingsPage-oldAbC12.js'
  f.storage.set(
    'tangent-mobile-shell-/-v1',
    new Map([
      ['/index.html', new Response('active old shell')],
      ['/__pwa_activation__', new Response('4')],
      [oldPath, new Response('active old lazy chunk')],
    ]),
  )
  f.storage.set(
    'tangent-mobile-shell-/-v2',
    new Map([['/index.html', new Response('completed but never activated waiting shell')]]),
  )
  await f.lifetime('install')
  await f.lifetime('activate')
  assert.equal(f.storage.has('tangent-mobile-shell-/-v1'), true)
  assert.equal(f.storage.has('tangent-mobile-shell-/-v2'), false)
  assert.equal(await (await f.request(oldPath)).response.text(), 'active old lazy chunk')
  assert.equal(
    await f.storage.get('tangent-mobile-shell-/-v3').get('/__pwa_activation__').text(),
    '5',
  )
})

test('only a waiting/installed replacement is shown as an update; initial installation is not an update', () => {
  const installed = { state: 'installed' }
  const active = { state: 'activated' }
  assert.equal(findWaitingUpdate({ waiting: null, active: null }, installed, false), null)
  assert.equal(findWaitingUpdate({ waiting: installed, active }, null, false), installed)
  // registration.waiting can still be null during the installed event.
  assert.equal(findWaitingUpdate({ waiting: null, active }, installed, false), installed)
  assert.equal(findWaitingUpdate({ waiting: null, active: null }, installed, true), installed)
  assert.equal(findWaitingUpdate({ waiting: null, active }, { state: 'installing' }, true), null)
  assert.equal(findWaitingUpdate(undefined, null, false), null)
})
