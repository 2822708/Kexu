import { legacyNames } from '../../../shared/brandCompatibility.mjs'
import { readLocalState, subscribeLocalChanges } from '../local/db'
import { createLogicalSnapshot } from '../local/snapshots/codec'
import { encryptSnapshot, generateBackupKey, sha256 } from '../local/snapshots/crypto'
import { registerVault, uploadCloudSnapshot, validateCredential, validateServerUrl } from './client'
import {
  changeBackupState,
  initialBackupState,
  readBackupState,
  type BackupJob,
  type BackupState,
  type RecoveryCredential,
} from './storage'

const DEBOUNCE_MS = 60_000
const MIN_INTERVAL_MS = 5 * 60_000
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
let running = false
let rerunRequested = false
let rerunForced = false
const owner = crypto.randomUUID()
let statusChannel: BroadcastChannel | undefined
function setupStatusChannel() {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' && !statusChannel) {
    statusChannel = new BroadcastChannel(`${legacyNames.backupDatabase}:changed`)
    statusChannel.onmessage = () => listeners.forEach((callback) => callback())
  }
}
const notify = () => {
  listeners.forEach((callback) => callback())
  setupStatusChannel()
  statusChannel?.postMessage({ changed: true })
}
export function subscribeBackupStatus(callback: () => void): () => void {
  setupStatusChannel()
  listeners.add(callback)
  return () => listeners.delete(callback)
}
export async function createBackupSpace(serverUrl: string): Promise<void> {
  const origin = validateServerUrl(serverUrl)
  const vault = await registerVault(origin)
  const credential = validateCredential({
    format: 'kexu-cloud-recovery',
    version: 1,
    serverUrl: origin,
    vaultId: vault.vaultId,
    token: vault.token,
    key: generateBackupKey(),
  })
  await importRecoveryCredential(credential)
}
export async function importRecoveryCredential(value: unknown): Promise<void> {
  const credential = validateCredential(value)
  await changeBackupState((state) =>
    Object.assign(state, initialBackupState(), {
      config: {
        ...credential,
        scopeId: crypto.randomUUID(),
        enabled: false,
        credentialSaved: false,
      },
    }),
  )
  notify()
}
export async function exportRecoveryCredential(): Promise<RecoveryCredential> {
  const { config } = await readBackupState()
  if (!config) throw new Error('尚未连接云备份空间')
  return validateCredential(config)
}
export async function setAutoBackup(enabled: boolean, credentialSaved = false): Promise<void> {
  await changeBackupState((state) => {
    if (!state.config) throw new Error('请先建立云备份空间')
    if (enabled && !credentialSaved && !state.config.credentialSaved)
      throw new Error('请先另存恢复凭证，再开启自动备份')
    state.config.credentialSaved ||= credentialSaved
    state.config.enabled = enabled
  })
  notify()
  if (enabled) void runBackup(true)
}
export async function disconnectBackup(): Promise<void> {
  await changeBackupState((state) => Object.assign(state, initialBackupState()))
  notify()
}
export function acceptUpload(state: BackupState, job: BackupJob, uploadedAt: string): boolean {
  if (!state.config || state.config.scopeId !== job.scopeId) return false
  if (state.lastDatasetId !== job.datasetId) {
    state.lastDatasetId = job.datasetId
    state.lastBackedUpRevision = -1
  }
  state.lastBackedUpRevision = Math.max(state.lastBackedUpRevision, job.revision)
  state.lastBackupAt = uploadedAt
  if (state.job?.snapshotId === job.snapshotId) state.job = null
  state.error = null
  state.failures = 0
  state.nextAttemptAt = 0
  return true
}
function schedule(delay = DEBOUNCE_MS, force = false) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void runBackup(force)
  }, delay)
}
export async function runBackup(force = false): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (running) {
    rerunRequested = true
    rerunForced ||= force
    return
  }
  running = true
  let scopeId: string | undefined
  try {
    const now = Date.now()
    const claimed = await changeBackupState((state) => {
      if (!state.config?.enabled || !state.config.credentialSaved) return
      if (state.lease && state.lease.owner !== owner && state.lease.until > now) return
      if (!force && state.nextAttemptAt > now) return
      if (!force && state.lastBackupAt && Date.parse(state.lastBackupAt) + MIN_INTERVAL_MS > now)
        return
      state.lease = { owner, until: now + 60_000 }
    })
    const config = claimed.config
    if (!config?.enabled || claimed.lease?.owner !== owner || claimed.lease.until <= now) {
      if (config?.enabled)
        schedule(
          Math.max(
            10_000,
            Math.min(MIN_INTERVAL_MS, claimed.nextAttemptAt - now || MIN_INTERVAL_MS),
          ),
        )
      return
    }
    scopeId = config.scopeId
    const local = await readLocalState()
    let job = claimed.job
    if (job && (job.scopeId !== scopeId || job.datasetId !== local.datasetId)) job = null
    if (
      !job &&
      claimed.lastDatasetId === local.datasetId &&
      claimed.lastBackedUpRevision >= local.revision
    )
      return
    if (!job) {
      const snapshot = createLogicalSnapshot(local)
      const body = JSON.stringify(await encryptSnapshot(snapshot, config.key))
      job = {
        scopeId,
        datasetId: local.datasetId,
        revision: local.revision,
        snapshotId: snapshot.snapshotId,
        body,
        sha256: await sha256(new TextEncoder().encode(body)),
      }
      const prepared = job
      const saved = await changeBackupState((state) => {
        if (state.config?.enabled && state.config.scopeId === scopeId) state.job = prepared
      })
      if (
        saved.config?.scopeId !== scopeId ||
        !saved.config.enabled ||
        saved.job?.snapshotId !== job.snapshotId
      )
        return
    }
    const metadata = await uploadCloudSnapshot(config, job.body)
    if (
      metadata.snapshotId !== job.snapshotId ||
      metadata.sha256 !== job.sha256 ||
      metadata.size !== new TextEncoder().encode(job.body).length ||
      metadata.datasetId !== job.datasetId ||
      metadata.revision !== job.revision
    )
      throw new Error('云端回执校验失败，已保留本机重试队列')
    const uploaded = job
    await changeBackupState((state) => {
      acceptUpload(state, uploaded, new Date().toISOString())
    })
    const latest = await readLocalState()
    if (latest.datasetId === job.datasetId && latest.revision > job.revision)
      schedule(MIN_INTERVAL_MS)
  } catch (error) {
    await changeBackupState((state) => {
      if (scopeId && state.config?.scopeId !== scopeId) return
      state.error = error instanceof Error ? error.message : '云备份失败，本地数据仍已保存'
      state.failures = Math.min(12, state.failures + 1)
      state.nextAttemptAt = Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** state.failures)
    }).catch(() => {})
    schedule(60_000)
  } finally {
    await changeBackupState((state) => {
      if (state.lease?.owner === owner) state.lease = null
    }).catch(() => {})
    running = false
    notify()
    if (rerunRequested) {
      const forced = rerunForced
      rerunRequested = false
      rerunForced = false
      schedule(1000, forced)
    }
  }
}
/** Called once after the local store is initialized. Local saves never await this service. */
export function startAutoBackup(): () => void {
  if (started) return () => {}
  started = true
  const unsubscribe = subscribeLocalChanges(() => {
    notify()
    schedule()
  })
  const foreground = () => {
    if (document.visibilityState === 'visible') void runBackup()
  }
  const online = () => {
    void runBackup()
  }
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', online)
  void runBackup()
  return () => {
    started = false
    unsubscribe()
    if (timer) clearTimeout(timer)
    document.removeEventListener('visibilitychange', foreground)
    window.removeEventListener('online', online)
  }
}
