import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createSnapshotServer, limitsFromEnv } from '../server.mjs'

async function fixture(limits = {}, allowedOrigin) {
  const parent = path.resolve('work', 'snapshot-service-tests')
  await mkdir(parent, { recursive: true })
  const dataDir = await mkdtemp(path.join(parent, 'case-'))
  const server = await createSnapshotServer({ dataDir, limits: { registrationsPerDay: 50, requestsPerMinute: 1000, concurrentUploads: 8, ...limits }, allowedOrigin })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const request = async (method, url, vault, body, extraHeaders = {}) => {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json', ...(vault ? { Authorization: `Bearer ${vault.vaultId}.${vault.token}` } : {}), ...extraHeaders }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  const register = async () => {
    const response = await request('POST', '/api/v1/vaults', null, {})
    assert.equal(response.status, 201)
    return response.body
  }
  const close = async () => {
    await new Promise((resolve) => server.close(resolve))
    server.closeAllConnections()
    assert.ok(dataDir.startsWith(parent + path.sep))
    await rm(dataDir, { recursive: true, force: true })
  }
  return { request, register, dataDir, server, close }
}
const envelope = (extra = {}) => ({ format: 'tangent-encrypted-snapshot', version: 1, snapshotId: randomUUID(), datasetId: randomUUID(), revision: 5, createdAt: new Date().toISOString(), algorithm: 'AES-GCM-256', keyId: 'a'.repeat(32), iv: 'A'.repeat(16), ciphertext: 'A'.repeat(48), ...extra })

test('health and registration expose no business CRUD; tokens are only stored hashed', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('GET', '/api/v1/health')).status, 200)
    assert.equal((await f.request('GET', '/api/courses')).status, 404)
    assert.equal((await f.request('POST', '/api/ai/chat', null, {})).status, 404)
    const vault = await f.register()
    const indexText = await readFile(path.join(f.dataDir, vault.vaultId, 'index.json'), 'utf8')
    assert.equal(indexText.includes(vault.token), false)
    assert.equal(JSON.parse(indexText).tokenHash, createHash('sha256').update(vault.token).digest('hex'))
    assert.equal((await f.request('GET', '/api/v1/snapshots')).status, 401)
    assert.equal((await f.request('GET', '/api/v1/snapshots', { ...vault, token: 'x'.repeat(43) })).status, 401)
  } finally { await f.close() }
})
test('snapshot upload is immutable, hash-verified and idempotent, including concurrent retries', async () => {
  const f = await fixture()
  try {
    const vault = await f.register(), item = envelope(), bytes = JSON.stringify(item)
    const results = await Promise.all(Array.from({ length: 4 }, () => f.request('POST', '/api/v1/snapshots', vault, bytes)))
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 201])
    const metadata = results[0].body
    assert.equal(metadata.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(metadata.size, Buffer.byteLength(bytes))
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, { ...item, ciphertext: 'B'.repeat(48) })).status, 409)
    assert.deepEqual((await f.request('GET', `/api/v1/snapshots/${item.snapshotId}/content`, vault)).body, item)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).body.items.length, 1)
  } finally { await f.close() }
})
test('foreign vault cannot list, download or delete another vault object even with its UUID', async () => {
  const f = await fixture()
  try {
    const a = await f.register(), b = await f.register(), item = envelope()
    await f.request('POST', '/api/v1/snapshots', a, item)
    assert.equal((await f.request('GET', '/api/v1/snapshots', b)).body.items.length, 0)
    assert.equal((await f.request('GET', `/api/v1/snapshots/${item.snapshotId}/content`, b)).status, 404)
    assert.equal((await f.request('DELETE', `/api/v1/snapshots/${item.snapshotId}`, b)).status, 404)
    assert.equal((await f.request('DELETE', `/api/v1/snapshots/${item.snapshotId}`, a)).status, 200)
    assert.equal((await f.request('GET', `/api/v1/snapshots/${item.snapshotId}/content`, a)).status, 404)
  } finally { await f.close() }
})
test('size, count and aggregate quotas reject writes without harming existing objects', async () => {
  const f = await fixture({ snapshotBytes: 1024, vaultSnapshots: 1, vaultBytes: 1024, totalBytes: 1024 })
  try {
    const vault = await f.register(), item = envelope()
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, envelope({ ciphertext: 'A'.repeat(2000) }))).status, 413)
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, item)).status, 201)
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, envelope())).status, 507)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).body.items.length, 1)
  } finally { await f.close() }
})
test('registration and authenticated request rate limits cannot be bypassed with X-Forwarded-For', async () => {
  const f = await fixture({ registrationsPerDay: 1, requestsPerMinute: 2 })
  try {
    const vault = await f.register()
    assert.equal((await f.request('POST', '/api/v1/vaults', null, {}, { 'X-Forwarded-For': '8.8.8.8' })).status, 429)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).status, 200)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).status, 200)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).status, 429)
  } finally { await f.close() }
})
test('unexpected fields, malformed envelopes, query credentials and foreign origins are rejected', async () => {
  const f = await fixture({}, 'https://timetable.example.test')
  try {
    const vault = await f.register()
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, { ...envelope(), token: 'must-not-store' })).status, 400)
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, { format: 'tangent-h2-backup' })).status, 400)
    assert.equal((await f.request('GET', '/api/v1/snapshots?token=bad', vault)).status, 400)
    assert.equal((await f.request('POST', '/api/v1/vaults', null, {}, { Origin: 'https://foreign.example.test' })).status, 403)
    assert.equal((await f.request('GET', '/api/v1/snapshots', vault)).body.items.length, 0)
  } finally { await f.close() }
})
test('private index and encrypted content survive service restart', async () => {
  const f = await fixture()
  let second
  try {
    const vault = await f.register(), item = envelope()
    await f.request('POST', '/api/v1/snapshots', vault, item)
    await new Promise((resolve) => f.server.close(resolve))
    second = await createSnapshotServer({ dataDir: f.dataDir })
    await new Promise((resolve) => second.listen(0, '127.0.0.1', resolve))
    const response = await fetch(`http://127.0.0.1:${second.address().port}/api/v1/snapshots/${item.snapshotId}/content`, { headers: { Authorization: `Bearer ${vault.vaultId}.${vault.token}` } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), item)
  } finally {
    if (second) await new Promise((resolve) => second.close(resolve))
    await f.close()
  }
})

test('noncanonical UUID casing cannot overwrite an immutable file on case-insensitive disks', async () => {
  const f = await fixture()
  try {
    const vault = await f.register(), item = envelope({ snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, item)).status, 201)
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, { ...item, snapshotId: item.snapshotId.toUpperCase(), ciphertext: 'B'.repeat(48) })).status, 400)
    assert.deepEqual((await f.request('GET', `/api/v1/snapshots/${item.snapshotId}/content`, vault)).body, item)
  } finally { await f.close() }
})
test('concurrent large-body uploads are bounded before buffering and a disconnected client releases its slot', async () => {
  const f = await fixture({ concurrentUploads: 1 })
  let held
  try {
    const vault = await f.register()
    held = http.request({ hostname: '127.0.0.1', port: f.server.address().port, path: '/api/v1/snapshots', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vault.vaultId}.${vault.token}` } })
    held.on('error', () => {})
    held.write('{"format":')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, envelope())).status, 429)
    held.destroy()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal((await f.request('POST', '/api/v1/snapshots', vault, envelope())).status, 201)
  } finally { held?.destroy(); await f.close() }
})
test('production quota environment overrides are numeric, bounded to safe integers and independently configurable', () => {
  assert.deepEqual(limitsFromEnv({ SNAPSHOT_MAX_TOTAL_BYTES: '268435456', SNAPSHOT_MAX_VAULT_BYTES: '33554432', SNAPSHOT_MAX_VAULTS: '16' }), { totalBytes: 268435456, vaultBytes: 33554432, vaultCount: 16 })
  assert.throws(() => limitsFromEnv({ SNAPSHOT_MAX_TOTAL_BYTES: '-1' }), /Invalid/)
  assert.throws(() => limitsFromEnv({ SNAPSHOT_MAX_VAULTS: 'NaN' }), /Invalid/)
})
