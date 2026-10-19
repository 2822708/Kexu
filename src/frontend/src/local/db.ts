import { createEmptyLocalState, newPublicId, type LocalState } from './types'
import { migrateLocalStateV1, validateLocalState } from './validation'
export { validateLocalState } from './validation'

export const LOCAL_DATABASE_NAME = 'tangent-timetable-local-v1'
const STORE_NAME = 'main'
const STATE_KEY = 'state'
let connection: Promise<IDBDatabase> | null = null
const subscribers = new Set<() => void>()
let channel: BroadcastChannel | null = null

function notify() {
  for (const cb of subscribers) {
    try {
      cb()
    } catch {
      /* A view cannot invalidate a successful commit. */
    }
  }
}
function setupChannel() {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' && channel == null) {
    try {
      channel = new BroadcastChannel(`${LOCAL_DATABASE_NAME}:changed`)
      channel.onmessage = () => notify()
    } catch {
      // Privacy policies can disable notifications while IndexedDB remains available.
      channel = null
    }
  }
}
export function subscribeLocalChanges(cb: () => void): () => void {
  setupChannel()
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('本地数据库不可用，请退出无痕浏览并允许网站保存数据'))
      return
    }
    const req = indexedDB.open(LOCAL_DATABASE_NAME, 2)
    let abandoned = false
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME))
        req.result.createObjectStore(STORE_NAME)
    }
    req.onerror = () => reject(new Error(`本地数据库无法打开：${req.error?.message ?? '未知错误'}`))
    req.onblocked = () => {
      abandoned = true
      reject(new Error('本地数据库升级被其他页面阻塞，请关闭其他课表页面后重试'))
    }
    req.onsuccess = () => {
      const db = req.result
      if (abandoned) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
  }).catch((error) => {
    connection = null
    throw error
  })
  return connection
}

/** Initializes in one read/write transaction so simultaneous first tabs create one dataset. */
export async function initializeLocalStore(): Promise<LocalState> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let result: LocalState
    let failure: unknown
    const get = store.get(STATE_KEY)
    get.onsuccess = () => {
      try {
        const original = get.result
        if (original?.schemaVersion === 1) {
          result = migrateLocalStateV1(original)
          // Both the exact old value and new state commit together, or neither does.
          store.put(original, 'migration:v1:recovery')
          store.put(result, STATE_KEY)
        } else result = original ?? createEmptyLocalState()
        validateLocalState(result)
        if (get.result == null) store.put(result, STATE_KEY)
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
    tx.oncomplete = () => {
      setupChannel()
      resolve(structuredClone(result))
    }
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('本地数据库初始化失败'))
    tx.onerror = () => {
      /* abort handler carries the transaction error */
    }
  })
}

export async function readLocalState(): Promise<LocalState> {
  await initializeLocalStore()
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(STATE_KEY)
    req.onsuccess = () => resolve(req.result as LocalState)
    req.onerror = () => reject(req.error ?? new Error('本地数据读取失败'))
  })
}

/** Callback must stay synchronous: all state checks, changes, and commit use one serialized IDB transaction. */
export async function mutateLocalState<T>(fn: (state: LocalState) => T): Promise<T> {
  await initializeLocalStore()
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let result: T
    let failure: unknown
    let changed = false
    const req = store.get(STATE_KEY)
    req.onsuccess = () => {
      try {
        const state = req.result as LocalState
        validateLocalState(state)
        const before = JSON.stringify(state)
        const previousRevision = state.revision
        const datasetId = state.datasetId,
          createdAt = state.createdAt
        result = fn(state)
        if (result != null && typeof (result as { then?: unknown }).then === 'function')
          throw new Error('本地事务回调必须同步执行')
        state.datasetId = datasetId
        state.createdAt = createdAt
        state.revision = previousRevision
        changed = JSON.stringify(state) !== before
        if (changed) {
          state.revision = previousRevision + 1
          state.updatedAt = new Date().toISOString()
          validateLocalState(state)
          store.put(state, STATE_KEY)
        }
        result = structuredClone(result)
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
    tx.oncomplete = () => {
      if (changed) {
        notify()
        try {
          channel?.postMessage({ changed: true })
        } catch {
          // A failed notification cannot turn a durable successful write into an error.
        }
      }
      resolve(result)
    }
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('本地数据未能保存，请检查可用存储空间'))
    tx.onerror = () => {
      /* resolve/reject only after the transaction settles */
    }
  })
}

export async function replaceLocalState(
  next: LocalState,
  expectedRevision?: number,
): Promise<void> {
  const incoming = structuredClone(next)
  validateLocalState(incoming)
  await mutateLocalState((state) => {
    if (expectedRevision != null && state.revision !== expectedRevision)
      throw new Error('本地数据在恢复预览后已改变，请重新预览后再恢复')
    const datasetId = state.datasetId,
      createdAt = state.createdAt,
      revision = state.revision
    Object.assign(state, incoming, {
      datasetId,
      createdAt,
      revision,
      dataGeneration: newPublicId(),
    })
  })
}

/** Primarily for isolated browser tests and version upgrades; never deletes user data. */
export async function closeLocalStore(): Promise<void> {
  if (connection) (await connection).close()
  connection = null
  channel?.close()
  channel = null
}
