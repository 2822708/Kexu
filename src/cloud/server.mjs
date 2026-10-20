import { legacyNames } from '../shared/brandCompatibility.mjs'
import http from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, unlink, readdir, chmod, open } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_LIMITS = Object.freeze({
  snapshotBytes: 10 * 1024 * 1024,
  vaultBytes: 100 * 1024 * 1024,
  vaultSnapshots: 50,
  totalBytes: 2 * 1024 * 1024 * 1024,
  vaultCount: 200,
  requestsPerMinute: 180,
  registrationsPerDay: 3,
  concurrentUploads: 2,
  concurrentDownloads: 2,
})
// Canonical lowercase UUIDs also preserve immutability on case-insensitive filesystems.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const digest = (value) => createHash('sha256').update(value).digest('hex')
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new HttpError(status, message) }

export function limitsFromEnv(env = process.env) {
  const mapping = {
    SNAPSHOT_MAX_SNAPSHOT_BYTES: 'snapshotBytes', SNAPSHOT_MAX_VAULT_BYTES: 'vaultBytes',
    SNAPSHOT_MAX_TOTAL_BYTES: 'totalBytes', SNAPSHOT_MAX_SNAPSHOTS: 'vaultSnapshots',
    SNAPSHOT_MAX_VAULTS: 'vaultCount', SNAPSHOT_REQUESTS_PER_MINUTE: 'requestsPerMinute',
    SNAPSHOT_REGISTRATIONS_PER_DAY: 'registrationsPerDay',
  }
  const limits = {}
  for (const [name, key] of Object.entries(mapping)) {
    if (env[name] === undefined) continue
    const value = Number(env[name])
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`)
    limits[key] = value
  }
  return limits
}

/** One process owns this private directory. It must never be served by nginx. */
export async function createSnapshotServer(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? process.env.SNAPSHOT_DATA_DIR ?? './private-snapshots')
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid snapshot limit')
  const allowedOrigin = options.allowedOrigin ? new URL(options.allowedOrigin).origin : undefined
  let activeUploads = 0
  let activeDownloads = 0
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await chmod(dataDir, 0o700)
  const vaults = new Map()
  let totalBytes = 0
  for (const entry of await readdir(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue
    let indexText
    try { indexText = await readFile(path.join(dataDir, entry.name, 'index.json'), 'utf8') }
    catch (error) {
      // A failed first registration may leave only its new directory, never an issued token.
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const index = JSON.parse(indexText)
    if (index.vaultId !== entry.name || !/^[0-9a-f]{64}$/.test(index.tokenHash)) throw new Error('Invalid private vault index')
    for (const item of index.snapshots) {
      if (!UUID.test(item.snapshotId) || !Number.isSafeInteger(item.size) || item.size < 1) throw new Error('Invalid private snapshot index')
      // An interrupted write can leave an unindexed object. Indexed objects must exist.
      const bytes = await readFile(path.join(dataDir, entry.name, `${item.snapshotId}.json`))
      if (bytes.length !== item.size || digest(bytes) !== item.sha256) throw new Error('Private snapshot integrity check failed')
      totalBytes += item.size
    }
    vaults.set(entry.name, index)
  }
  const windows = new Map()
  let serial = Promise.resolve()
  const exclusive = async (fn) => {
    const result = serial.then(fn)
    serial = result.catch(() => {})
    return result
  }
  const syncDirectory = async (directory) => {
    if (process.platform === 'win32') return
    const handle = await open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }
  const atomicWrite = async (file, bytes) => {
    const tmp = `${file}.${randomUUID()}.tmp`
    const handle = await open(tmp, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await rename(tmp, file)
    await syncDirectory(path.dirname(file))
  }
  const saveIndex = async (index) => {
    const dir = path.join(dataDir, index.vaultId)
    await atomicWrite(path.join(dir, 'index.json'), JSON.stringify(index))
  }
  const rateLimit = (key, maximum, period) => {
    const now = Date.now()
    // Bound memory even when the service is directly exposed to many remote IPs.
    if (windows.size > 10_000) {
      for (const [k, value] of windows) if (value.until <= now) windows.delete(k)
      if (windows.size > 10_000) fail(429, '请求过多，请稍后重试')
    }
    const current = windows.get(key)
    if (!current || current.until <= now) windows.set(key, { count: 1, until: now + period })
    else if (++current.count > maximum) fail(429, '请求过多，请稍后重试')
  }
  const readBody = async (req, maximum) => {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) fail(415, '需要 application/json')
    const length = Number(req.headers['content-length'] ?? 0)
    if (!Number.isFinite(length) || length > maximum) fail(413, '快照超过大小限制')
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > maximum) fail(413, '快照超过大小限制')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  const validateEnvelope = (body) => {
    let envelope
    try { envelope = JSON.parse(body.toString('utf8')) } catch { fail(400, 'JSON 格式无效') }
    if (!envelope || !['kexu-encrypted-snapshot', legacyNames.encryptedSnapshot].includes(envelope.format) || envelope.version !== 1 ||
      !UUID.test(envelope.snapshotId ?? '') || !UUID.test(envelope.datasetId ?? '') ||
      !Number.isSafeInteger(envelope.revision) || envelope.revision < 0 ||
      typeof envelope.createdAt !== 'string' || !Number.isFinite(Date.parse(envelope.createdAt)) ||
      envelope.algorithm !== 'AES-GCM-256' || typeof envelope.keyId !== 'string' || !/^[0-9a-f]{32}$/.test(envelope.keyId) ||
      typeof envelope.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) ||
      typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 24 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) fail(400, '加密快照封装无效')
    const allowed = new Set(['format', 'version', 'snapshotId', 'datasetId', 'revision', 'createdAt', 'algorithm', 'keyId', 'iv', 'ciphertext'])
    if (Object.keys(envelope).some((key) => !allowed.has(key))) fail(400, '加密快照包含未知字段')
    return envelope
  }
  const authenticate = (req) => {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')
    const index = match && vaults.get(match[1])
    const suppliedHash = digest(match?.[2] ?? '')
    const expectedHash = index?.tokenHash ?? '0'.repeat(64)
    if (!match || !index || !timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(expectedHash))) fail(401, '云备份凭证无效')
    rateLimit(`vault:${index.vaultId}`, limits.requestsPerMinute, 60_000)
    return index
  }
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  const server = http.createServer(async (req, res) => {
    // No permissive CORS: serve the web app and this API under one HTTPS origin.
    let uploadReserved = false
    let downloadReserved = false
    res.setTimeout(30_000, () => res.destroy())
    try {
      const url = new URL(req.url, 'http://snapshot.invalid')
      if (url.search) fail(400, '不支持查询参数')
      if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, { status: 'ok', protocol: 1 })
      const origin = req.headers.origin
      if (origin && allowedOrigin && origin !== allowedOrigin) fail(403, '来源不允许')
      if (req.method === 'POST' && url.pathname === '/api/v1/vaults') {
        // Trust only the socket address; a client-supplied X-Forwarded-For cannot bypass limits.
        rateLimit(`register:${req.socket.remoteAddress}`, limits.registrationsPerDay, 86_400_000)
        const body = await readBody(req, 128)
        if (body.toString('utf8').trim() !== '{}') fail(400, '注册请求应为空对象')
        return await exclusive(async () => {
          if (vaults.size >= limits.vaultCount) fail(507, '云备份空间名额已满')
          const vaultId = randomUUID()
          const token = randomBytes(32).toString('base64url')
          const index = { vaultId, tokenHash: digest(token), createdAt: new Date().toISOString(), snapshots: [] }
          await mkdir(path.join(dataDir, vaultId), { mode: 0o700 })
          await syncDirectory(dataDir)
          await saveIndex(index)
          vaults.set(vaultId, index)
          send(res, 201, { vaultId, token, limits: { snapshotBytes: limits.snapshotBytes, vaultBytes: limits.vaultBytes, vaultSnapshots: limits.vaultSnapshots } })
        })
      }
      if (!url.pathname.startsWith('/api/v1/snapshots')) fail(404, '未找到接口')
      const index = authenticate(req)
      if (url.pathname === '/api/v1/snapshots' && req.method === 'GET') {
        return send(res, 200, { items: [...index.snapshots].reverse(), usedBytes: index.snapshots.reduce((n, s) => n + s.size, 0), limits: { snapshotBytes: limits.snapshotBytes, vaultBytes: limits.vaultBytes, vaultSnapshots: limits.vaultSnapshots } })
      }
      if (url.pathname === '/api/v1/snapshots' && req.method === 'POST') {
        if (activeUploads >= limits.concurrentUploads) fail(429, '云备份正在处理其他上传，请稍后重试')
        activeUploads++
        uploadReserved = true
        const bytes = await readBody(req, limits.snapshotBytes)
        const envelope = validateEnvelope(bytes)
        const sha256 = digest(bytes)
        return await exclusive(async () => {
          const previous = index.snapshots.find((item) => item.snapshotId === envelope.snapshotId)
          if (previous) {
            if (previous.sha256 !== sha256 || previous.size !== bytes.length) fail(409, '快照 ID 已存在且内容不同')
            return send(res, 200, previous)
          }
          const used = index.snapshots.reduce((n, s) => n + s.size, 0)
          if (index.snapshots.length >= limits.vaultSnapshots || used + bytes.length > limits.vaultBytes || totalBytes + bytes.length > limits.totalBytes) fail(507, '云快照配额已满，请手动删除旧快照')
          const metadata = { snapshotId: envelope.snapshotId, datasetId: envelope.datasetId, revision: envelope.revision, createdAt: envelope.createdAt, uploadedAt: new Date().toISOString(), size: bytes.length, sha256 }
          const file = path.join(dataDir, index.vaultId, `${envelope.snapshotId}.json`)
          // An orphan from an interrupted index update may be replaced with this verified request.
          await atomicWrite(file, bytes)
          const next = { ...index, snapshots: [...index.snapshots, metadata] }
          await saveIndex(next)
          index.snapshots = next.snapshots
          totalBytes += bytes.length
          send(res, 201, metadata)
        })
      }
      const match = /^\/api\/v1\/snapshots\/([0-9a-f-]{36})(\/content)?$/.exec(url.pathname)
      if (!match || !UUID.test(match[1])) fail(404, '未找到快照')
      const metadata = index.snapshots.find((item) => item.snapshotId === match[1])
      // Both unknown and foreign IDs return the same response.
      if (!metadata) fail(404, '未找到快照')
      if (req.method === 'GET' && match[2]) {
        if (activeDownloads >= limits.concurrentDownloads) fail(429, '云备份正在处理其他下载，请稍后重试')
        activeDownloads++
        downloadReserved = true
        const bytes = await readFile(path.join(dataDir, index.vaultId, `${metadata.snapshotId}.json`))
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Snapshot-SHA256': metadata.sha256 })
        return await new Promise((resolve) => { res.once('close', resolve); res.end(bytes, resolve) })
      }
      if (req.method === 'DELETE' && !match[2]) {
        return await exclusive(async () => {
          const current = index.snapshots.find((item) => item.snapshotId === metadata.snapshotId)
          if (!current) fail(404, '未找到快照')
          const next = { ...index, snapshots: index.snapshots.filter((item) => item.snapshotId !== metadata.snapshotId) }
          await saveIndex(next)
          index.snapshots = next.snapshots
          totalBytes -= current.size
          await unlink(path.join(dataDir, index.vaultId, `${metadata.snapshotId}.json`)).catch(() => {})
          await syncDirectory(path.join(dataDir, index.vaultId))
          send(res, 200, { deleted: true })
        })
      }
      fail(405, '请求方式不支持')
    } catch (error) {
      if (!res.headersSent) send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : '快照服务暂时不可用' })
      else res.end()
      req.resume()
      // Never log request headers, content, credentials, or a filesystem exception with private paths.
    } finally {
      if (uploadReserved) activeUploads--
      if (downloadReserved) activeDownloads--
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 40
  server.maxConnections = 16
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 9001)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  const server = await createSnapshotServer({ allowedOrigin: process.env.SNAPSHOT_ALLOWED_ORIGIN, limits: limitsFromEnv() })
  server.listen(port, '127.0.0.1', () => console.log(`Private snapshot service listening on 127.0.0.1:${port}`))
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
