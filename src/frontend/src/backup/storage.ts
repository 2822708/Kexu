import { legacyNames } from '../../../shared/brandCompatibility.mjs'
import type { EncryptedSnapshot } from '../local/snapshots/crypto'
import type { LogicalSnapshot } from '../local/snapshots/codec'

export interface RecoveryCredential {
  format: 'kexu-cloud-recovery'
  version: 1
  serverUrl: string
  vaultId: string
  token: string
  key: string
}
export interface BackupConfig extends RecoveryCredential {
  scopeId: string
  enabled: boolean
  credentialSaved: boolean
}
export interface BackupJob {
  scopeId: string
  datasetId: string
  revision: number
  body: string
  sha256: string
  snapshotId: string
}
export interface BackupState {
  config: BackupConfig | null
  job: BackupJob | null
  lastBackedUpRevision: number
  lastDatasetId: string | null
  lastBackupAt: string | null
  error: string | null
  failures: number
  nextAttemptAt: number
  lease: { owner: string; until: number } | null
}
export interface RestorePointMetadata {
  snapshotId: string
  createdAt: string
  revision: number
}
export const initialBackupState = (): BackupState => ({
  config: null,
  job: null,
  lastBackedUpRevision: -1,
  lastDatasetId: null,
  lastBackupAt: null,
  error: null,
  failures: 0,
  nextAttemptAt: 0,
  lease: null,
})
let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(legacyNames.backupDatabase, 2)
    let failed = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state'))
        request.result.createObjectStore('state')
      if (!request.result.objectStoreNames.contains('restorePoints'))
        request.result.createObjectStore('restorePoints', { keyPath: 'snapshotId' })
      if (!request.result.objectStoreNames.contains('restorePointMetadata')) {
        const metadata = request.result.createObjectStore('restorePointMetadata', {
          keyPath: 'snapshotId',
        })
        // Upgrade v1 locally and transactionally without changing its backup credentials or bodies.
        const cursor = request.transaction!.objectStore('restorePoints').openCursor()
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) return
          const point = item.value as LogicalSnapshot
          metadata.put({
            snapshotId: point.snapshotId,
            createdAt: point.createdAt,
            revision: point.source.revision,
          })
          item.continue()
        }
      }
    }
    request.onsuccess = () => {
      if (failed) {
        request.result.close()
        return
      }
      request.result.onversionchange = () => {
        request.result.close()
        database = undefined
      }
      resolve(request.result)
    }
    request.onblocked = () => {
      failed = true
      database = undefined
      reject(new Error('备份存储升级被其他页面阻塞，请关闭其他课表标签页后重试'))
    }
    request.onerror = () => {
      database = undefined
      reject(new Error('无法打开本机备份队列'))
    }
  })
  return database
}
export async function readBackupState(): Promise<BackupState> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readonly')
    const request = transaction.objectStore('state').get('backup')
    request.onsuccess = () =>
      resolve((request.result as BackupState | undefined) ?? initialBackupState())
    request.onerror = () => reject(new Error('无法读取本机备份队列'))
  })
}
/** A synchronous mutator runs inside the IndexedDB transaction, including cross-tab leases. */
export async function changeBackupState(
  mutator: (state: BackupState) => void,
): Promise<BackupState> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite')
    const store = transaction.objectStore('state')
    const request = store.get('backup')
    let next: BackupState
    let failure: unknown
    request.onsuccess = () => {
      next = (request.result as BackupState | undefined) ?? initialBackupState()
      try {
        mutator(next)
        store.put(next, 'backup')
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }
    transaction.oncomplete = () => resolve(next)
    transaction.onerror = transaction.onabort = () =>
      reject(failure ?? new Error('无法保存本机备份队列；本地课表未受影响'))
  })
}
export async function saveRestorePoint(snapshot: LogicalSnapshot): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['restorePoints', 'restorePointMetadata'], 'readwrite')
    const store = transaction.objectStore('restorePoints')
    const metadata = transaction.objectStore('restorePointMetadata')
    store.put(snapshot)
    metadata.put({
      snapshotId: snapshot.snapshotId,
      createdAt: snapshot.createdAt,
      revision: snapshot.source.revision,
    })
    const all = metadata.getAll()
    all.onsuccess = () => {
      const points = (all.result as RestorePointMetadata[])
        .filter((point) => point.snapshotId !== snapshot.snapshotId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      for (const point of points.slice(9)) {
        store.delete(point.snapshotId)
        metadata.delete(point.snapshotId)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () =>
      reject(new Error('无法保存恢复前的本机恢复点，已中止替换'))
  })
}
/** Settings lists only tiny metadata; a ten-point history can contain up to 70 MiB of payloads. */
export async function listRestorePointMetadata(): Promise<RestorePointMetadata[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('restorePointMetadata', 'readonly')
      .objectStore('restorePointMetadata')
      .getAll()
    request.onsuccess = () =>
      resolve(
        (request.result as RestorePointMetadata[]).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      )
    request.onerror = () => reject(new Error('无法读取本机恢复点列表'))
  })
}
export async function readRestorePoint(snapshotId: string): Promise<LogicalSnapshot> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('restorePoints', 'readonly')
      .objectStore('restorePoints')
      .get(snapshotId)
    request.onsuccess = () =>
      request.result
        ? resolve(request.result as LogicalSnapshot)
        : reject(new Error('此本机恢复点已不存在'))
    request.onerror = () => reject(new Error('无法读取本机恢复点'))
  })
}
export async function listRestorePoints(): Promise<LogicalSnapshot[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db
      .transaction('restorePoints', 'readonly')
      .objectStore('restorePoints')
      .getAll()
    request.onsuccess = () =>
      resolve(
        (request.result as LogicalSnapshot[]).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      )
    request.onerror = () => reject(new Error('无法读取本机恢复点'))
  })
}
export type { EncryptedSnapshot }
