import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import ts from 'typescript'
import { createSnapshotServer } from '../../cloud/server.mjs'

function setup(overrides = {}) {
  const modules = new Map(),
    indexedDB = new IDBFactory(),
    nativeRequire = createRequire(import.meta.url)
  const context = vm.createContext({
    indexedDB,
    crypto: webcrypto,
    structuredClone,
    console,
    setTimeout: (...args) => {
      const timer = setTimeout(...args)
      timer.unref()
      return timer
    },
    clearTimeout,
    Intl,
    Date,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    fetch,
    URL,
    AbortController,
    ...overrides,
  })
  function loadSource(url) {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }
    modules.set(url.href, module)
    const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
    vm.runInContext(`(function(module,exports,require){${compiled}\n})`, context, {
      filename: url.pathname,
    })(module, module.exports, (name) =>
      name.startsWith('.') ? loadSource(new URL(`${name}.ts`, url)) : nativeRequire(name),
    )
    return module.exports
  }
  const load = (path) => loadSource(new URL(`../src/${path}.ts`, import.meta.url))
  return {
    ...load('local/db'),
    ...load('local/types'),
    ...load('local/domain'),
    ...load('local/snapshots/codec'),
    ...load('local/snapshots/crypto'),
    ...load('local/snapshots/restore'),
    ...load('backup/coordinator'),
    storage: load('backup/storage'),
    indexedDB,
    load,
  }
}
const normal = (value) => JSON.parse(JSON.stringify(value))
const scheduleBody = {
  name: '核心数据',
  periodStartDate: '2026-09-01',
  periodEndDate: '2027-01-31',
}
async function populated(x) {
  const schedule = await x.localScheduleApi.create(scheduleBody)
  const course = await x.localCourseApi.create(schedule.id, {
    name: '数学',
    location: null,
    teacher: null,
    dayOfWeek: 2,
    startPeriod: 1,
    endPeriod: 2,
    weeks: [1, 2, 3],
  })
  await x.localExamApi.create(schedule.id, {
    name: '期末',
    location: null,
    examDate: '2027-01-01',
    startTime: '09:00',
    endTime: '10:00',
  })
  const rule = await x.localRecurringApi.create({
    title: '复习',
    frequency: 'DAILY',
    dayOfWeek: null,
    dayOfMonth: null,
    triggerTime: '20:00',
    script: null,
    ddlOffsetMinutes: 60,
    enabled: true,
    chainAfterComplete: false,
  })
  await x.localRecurringApi.triggerNow(rule.id)
  await x.localFocusApi.setCourseCompleted(course.id, {
    scheduleId: schedule.id,
    date: '2026-09-01',
    completed: true,
  })
  return x.readLocalState()
}

test('logical export whitelists core fields, uses UUID references, and excludes credentials and AI actions', async () => {
  const x = setup()
  await populated(x)
  await x.mutateLocalState((state) => {
    state.schedules[0].apiKey = 'SECRET-MUST-NOT-EXPORT'
    const conversationId = state.nextId++
    state.conversations.push({
      id: conversationId,
      publicId: webcrypto.randomUUID(),
      title: 'private history',
      scheduleId: null,
    })
    state.messages.push({
      messageId: state.nextId++,
      publicId: webcrypto.randomUUID(),
      conversationId,
      role: 'assistant',
      text: 'DO-NOT-EXPORT-HISTORY',
      actions: [
        {
          actionId: 1,
          type: 'DELETE_TODO',
          status: 'PENDING',
          scope: 'TODO',
          data: { todoIds: [1] },
        },
      ],
    })
  })
  const state = await x.readLocalState(),
    snapshot = x.createLogicalSnapshot(state),
    serialized = JSON.stringify(snapshot)
  assert.equal(serialized.includes('SECRET-MUST-NOT-EXPORT'), false)
  assert.equal(serialized.includes('DO-NOT-EXPORT-HISTORY'), false)
  assert.equal(serialized.includes('DELETE_TODO'), false)
  assert.equal(snapshot.data.courses[0].scheduleId, snapshot.data.schedules[0].id)
  assert.equal(snapshot.data.todos.find((t) => t.examId).examId, snapshot.data.exams[0].id)
  assert.equal(
    snapshot.data.recurringOccurrences[0].recurringId,
    snapshot.data.recurringRules[0].id,
  )
  assert.equal(snapshot.data.periods[0].id, state.periods[0].publicId)
})
test('AES-GCM round trip recovers all core collections with independently exported key', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x)),
    key = x.generateBackupKey()
  const encrypted = await x.encryptSnapshot(snapshot, key)
  assert.equal(encrypted.ciphertext.includes('数学'), false)
  assert.deepEqual(normal(await x.decryptSnapshot(encrypted, key)), normal(snapshot))
  assert.equal(x.fromBase64(key).length, 32)
})
test('wrong keys, tampered ciphertext and altered authenticated metadata are rejected', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x)),
    key = x.generateBackupKey()
  const envelope = await x.encryptSnapshot(snapshot, key)
  await assert.rejects(x.decryptSnapshot(envelope, x.generateBackupKey()), /凭证不能解密/)
  await assert.rejects(
    x.decryptSnapshot({ ...envelope, revision: envelope.revision + 1 }, key),
    /解密失败/,
  )
  await assert.rejects(
    x.decryptSnapshot(
      {
        ...envelope,
        ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1),
      },
      key,
    ),
    /解密失败/,
  )
})
test('H2 files, secrets, dangling UUIDs and invalid dates cannot pass restore preview', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x)),
    before = await x.readLocalState()
  await assert.rejects(x.previewRestore({ format: 'tangent-h2-backup' }), /核心逻辑快照/)
  await assert.rejects(x.previewRestore({ ...snapshot, token: 'forbidden' }), /不支持的字段/)
  const dangling = structuredClone(snapshot)
  dangling.data.courses[0].scheduleId = webcrypto.randomUUID()
  await assert.rejects(x.previewRestore(dangling), /悬空关联/)
  const invalid = structuredClone(snapshot)
  invalid.data.schedules[0].periodStartDate = '2026-02-30'
  await assert.rejects(x.previewRestore(invalid), /日期/)
  assert.deepEqual(normal(await x.readLocalState()), normal(before))
})
test('confirmed restore keeps receiver identity, stable UUIDs and associations, increments revision, and retains restore point', async () => {
  const source = setup(),
    snapshot = source.createLogicalSnapshot(await populated(source))
  const x = setup()
  await x.localTodoApi.create({ title: 'old receiver data', ddl: '2040-01-01T09:00' })
  const before = await x.readLocalState(),
    preview = await x.previewRestore(snapshot)
  await x.restoreConfirmed(preview)
  const after = await x.readLocalState()
  assert.equal(after.datasetId, before.datasetId)
  assert.equal(after.createdAt, before.createdAt)
  assert.equal(after.revision, before.revision + 1)
  assert.equal(after.schedules[0].publicId, snapshot.data.schedules[0].id)
  assert.equal(after.courses[0].scheduleId, after.schedules[0].id)
  assert.equal(after.todos.find((t) => t.examId).examId, after.exams[0].id)
  assert.equal(after.recurringOccurrences[0].recurringId, after.recurringRules[0].id)
  assert.equal(after.focusCompletions[0].courseId, after.courses[0].id)
  assert.equal(after.messages.length, 0)
  assert.equal((await x.storage.listRestorePoints())[0].data.todos[0].title, 'old receiver data')
})
test('preview never changes local data and stale confirmation cannot overwrite a new write', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x)),
    before = await x.readLocalState()
  const preview = await x.previewRestore(snapshot)
  assert.deepEqual(normal(await x.readLocalState()), normal(before))
  await x.localTodoApi.create({ title: 'new write', ddl: '2040-01-01T09:00' })
  const latest = await x.readLocalState()
  await assert.rejects(x.restoreConfirmed(preview), /已改变/)
  assert.deepEqual(normal(await x.readLocalState()), normal(latest))
})
test('write racing after recovery-point save is protected by the final database transaction revision check', async () => {
  const source = setup(),
    snapshot = source.createLogicalSnapshot(await populated(source)),
    x = setup()
  const preview = await x.previewRestore(snapshot),
    save = x.storage.saveRestorePoint
  x.storage.saveRestorePoint = async (point) => {
    await save(point)
    await x.localTodoApi.create({ title: 'racing write', ddl: '2040-01-01T09:00' })
  }
  await assert.rejects(x.restoreConfirmed(preview), /改变/)
  const current = await x.readLocalState()
  assert.equal(current.todos[0].title, 'racing write')
  assert.equal(current.schedules.length, 0)
  assert.equal((await x.storage.listRestorePoints()).length, 1)
})
test('a failed recovery-point save aborts restore without partial data or revision changes', async () => {
  const source = setup(),
    snapshot = source.createLogicalSnapshot(await populated(source)),
    x = setup()
  const preview = await x.previewRestore(snapshot),
    before = await x.readLocalState()
  x.storage.saveRestorePoint = async () => {
    throw new Error('quota exhausted while saving recovery point')
  }
  await assert.rejects(x.restoreConfirmed(preview), /quota exhausted/)
  assert.deepEqual(normal(await x.readLocalState()), normal(before))
})
test('backup acknowledgement is scoped and monotonic; old request cannot clear a newer queued job', () => {
  const x = setup(),
    state = x.storage.initialBackupState()
  state.config = { scopeId: 'scope-a' }
  state.lastDatasetId = 'dataset-a'
  state.lastBackedUpRevision = 10
  state.job = { scopeId: 'scope-a', datasetId: 'dataset-a', revision: 12, snapshotId: 'new-job' }
  assert.equal(
    x.acceptUpload(
      state,
      { scopeId: 'scope-b', datasetId: 'dataset-a', revision: 100, snapshotId: 'foreign' },
      '2026-10-18T00:00:00Z',
    ),
    false,
  )
  assert.equal(state.lastBackedUpRevision, 10)
  x.acceptUpload(
    state,
    { scopeId: 'scope-a', datasetId: 'dataset-a', revision: 8, snapshotId: 'old' },
    '2026-10-18T00:00:00Z',
  )
  assert.equal(state.lastBackedUpRevision, 10)
  assert.equal(state.job.snapshotId, 'new-job')
  x.acceptUpload(
    state,
    { scopeId: 'scope-a', datasetId: 'dataset-a', revision: 12, snapshotId: 'new-job' },
    '2026-10-18T00:00:00Z',
  )
  assert.equal(state.lastBackedUpRevision, 12)
  assert.equal(state.job, null)
})
test('persisted retry jobs retain exact ciphertext/id/hash after IndexedDB re-read', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x)),
    body = JSON.stringify(await x.encryptSnapshot(snapshot, x.generateBackupKey()))
  const job = {
    scopeId: 'scope',
    datasetId: snapshot.source.datasetId,
    revision: snapshot.source.revision,
    snapshotId: snapshot.snapshotId,
    body,
    sha256: await x.sha256(new TextEncoder().encode(body)),
  }
  await x.storage.changeBackupState((state) => {
    state.job = job
    state.nextAttemptAt = Date.now() + 60_000
  })
  const restored = await x.storage.readBackupState()
  assert.deepEqual(normal(restored.job), job)
  assert.ok(restored.nextAttemptAt > Date.now())
})

test('real HTTP automatic backup retries identical ciphertext, preserves new writes, and restores into a second device', async () => {
  const parent = path.resolve('work', 'snapshot-client-http-tests')
  await mkdir(parent, { recursive: true })
  const dataDir = await mkdtemp(path.join(parent, 'case-'))
  const server = await createSnapshotServer({ dataDir })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const sentBodies = []
  let failFirst = true
  const x = setup({
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/v1/snapshots') && init?.method === 'POST') {
        sentBodies.push(init.body)
        if (failFirst) {
          failFirst = false
          return new Response('{"error":"temporary"}', { status: 503 })
        }
      }
      return fetch(url, init)
    },
  })
  async function waitFor(predicate) {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('Timed out waiting for asynchronous backup state')
  }
  try {
    const captured = await populated(x)
    await x.createBackupSpace(origin)
    const credential = await x.exportRecoveryCredential()
    await assert.rejects(x.setAutoBackup(true), /另存恢复凭证/)
    await x.setAutoBackup(true, true)
    await waitFor(async () => {
      const state = await x.storage.readBackupState()
      return !!state.error && !!state.job && state.lease === null
    })
    const failed = await x.storage.readBackupState()
    assert.equal(failed.lastBackedUpRevision, -1)
    assert.equal(failed.job.revision, captured.revision)
    await x.localTodoApi.create({ title: 'saved during cloud failure', ddl: '2040-01-01T09:00' })
    await x.runBackup(true)
    const firstSuccess = await x.storage.readBackupState()
    assert.equal(sentBodies[0], sentBodies[1])
    assert.equal(firstSuccess.lastBackedUpRevision, captured.revision)
    assert.ok((await x.readLocalState()).revision > firstSuccess.lastBackedUpRevision)
    await x.runBackup(true)
    const local = await x.readLocalState(),
      latest = await x.storage.readBackupState()
    assert.equal(latest.lastBackedUpRevision, local.revision)
    assert.equal(latest.job, null)
    assert.equal(latest.error, null)
    const client = x.load('backup/client')
    const list = await client.listCloudSnapshots(credential)
    assert.equal(list.items.length, 2)
    const newest = list.items.find((item) => item.revision === local.revision)
    const encrypted = await client.downloadCloudSnapshot(credential, newest.snapshotId)
    const receiver = setup(),
      receiverBefore = await receiver.initializeLocalStore()
    const snapshot = await receiver.decryptSnapshot(encrypted, credential.key)
    await receiver.restoreConfirmed(await receiver.previewRestore(snapshot))
    const receiverState = await receiver.readLocalState()
    assert.equal(receiverState.datasetId, receiverBefore.datasetId)
    assert.ok(receiverState.todos.some((todo) => todo.title === 'saved during cloud failure'))
    assert.equal(receiverState.courses[0].publicId, local.courses[0].publicId)
    assert.equal(receiverState.todos.find((todo) => todo.examId).examId, receiverState.exams[0].id)
    await receiver.closeLocalStore()
  } finally {
    await x.disconnectBackup()
    await x.closeLocalStore()
    await new Promise((resolve) => server.close(resolve))
    assert.ok(dataDir.startsWith(parent + path.sep))
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('local update checkpoint saves without any cloud request and refuses a stale expected revision', async () => {
  const x = setup({
    fetch: () => {
      throw new Error('a local checkpoint must never use the network')
    },
  })
  const state = await populated(x)
  const point = await x.saveCurrentRestorePoint(state.revision)
  assert.equal(point.revision, state.revision)
  assert.equal(point.datasetId, state.datasetId)
  assert.equal((await x.storage.listRestorePoints())[0].snapshotId, point.snapshotId)
  await x.localTodoApi.create({ title: 'checkpoint race', ddl: '2040-01-01T09:00' })
  await assert.rejects(x.saveCurrentRestorePoint(state.revision), /已改变/)
  assert.equal((await x.storage.listRestorePoints()).length, 1)
})

test('recovery-point retention always preserves the newly saved point even when timestamps tie', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(await populated(x))
  let latest
  for (let i = 0; i < 12; i++) {
    latest = { ...snapshot, snapshotId: webcrypto.randomUUID() }
    await x.storage.saveRestorePoint(latest)
  }
  const points = await x.storage.listRestorePoints()
  assert.equal(points.length, 10)
  assert.ok(points.some((point) => point.snapshotId === latest.snapshotId))
})

test('switching vault during an upload ignores its late receipt and automatically backs up the newly enabled scope', async () => {
  const parent = path.resolve('work', 'snapshot-client-http-tests')
  await mkdir(parent, { recursive: true })
  const dataDir = await mkdtemp(path.join(parent, 'scope-'))
  const server = await createSnapshotServer({ dataDir })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  let aRequested = false,
    bRequested = false,
    releaseA,
    releaseB
  const gateA = new Promise((resolve) => {
      releaseA = resolve
    }),
    gateB = new Promise((resolve) => {
      releaseB = resolve
    })
  const x = setup({
    fetch: async (url, init) => {
      if (String(url).endsWith('/api/v1/snapshots') && init?.method === 'POST') {
        if (!aRequested) {
          aRequested = true
          await gateA
        } else {
          bRequested = true
          await gateB
        }
      }
      return fetch(url, init)
    },
  })
  async function until(predicate) {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('Timed out waiting for scope transition')
  }
  try {
    const local = await populated(x)
    await x.createBackupSpace(origin)
    await x.setAutoBackup(true, true)
    await until(() => aRequested)
    await x.createBackupSpace(origin)
    const newCredential = await x.exportRecoveryCredential()
    await x.setAutoBackup(true, true)
    releaseA()
    await until(() => bRequested)
    const pending = await x.storage.readBackupState()
    assert.equal(pending.config.vaultId, newCredential.vaultId)
    assert.equal(pending.lastBackedUpRevision, -1)
    releaseB()
    await until(
      async () => (await x.storage.readBackupState()).lastBackedUpRevision === local.revision,
    )
    assert.equal((await x.load('backup/client').listCloudSnapshots(newCredential)).items.length, 1)
  } finally {
    releaseA()
    releaseB()
    await x.disconnectBackup()
    await x.closeLocalStore()
    await new Promise((resolve) => server.close(resolve))
    assert.ok(dataDir.startsWith(parent + path.sep))
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('backup database v1 upgrade preserves retry state and recovery payload while creating a small metadata index', async () => {
  const x = setup(),
    snapshot = x.createLogicalSnapshot(x.createEmptyLocalState())
  const previous = x.storage.initialBackupState()
  previous.job = {
    scopeId: 'old-scope',
    datasetId: snapshot.source.datasetId,
    revision: 0,
    snapshotId: snapshot.snapshotId,
    body: 'previous-ciphertext-retained',
    sha256: 'a'.repeat(64),
  }
  await new Promise((resolve, reject) => {
    const request = x.indexedDB.open('tangent-private-backup-v1', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state')
      request.result.createObjectStore('restorePoints', { keyPath: 'snapshotId' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result,
        transaction = database.transaction(['state', 'restorePoints'], 'readwrite')
      transaction.objectStore('state').put(previous, 'backup')
      transaction.objectStore('restorePoints').put(snapshot)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
  const metadata = await x.storage.listRestorePointMetadata()
  assert.deepEqual(normal(metadata), [
    { snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt, revision: 0 },
  ])
  assert.equal(metadata[0].data, undefined)
  assert.equal((await x.storage.readBackupState()).job.body, previous.job.body)
  assert.deepEqual(normal(await x.storage.readRestorePoint(snapshot.snapshotId)), normal(snapshot))
})

test('restore never reuses receiver numeric IDs, so an unsaved old form cannot edit a different imported todo', async () => {
  const source = setup()
  await source.localTodoApi.create({ title: 'imported todo', ddl: '2040-01-01T09:00' })
  const snapshot = source.createLogicalSnapshot(await source.readLocalState())
  const receiver = setup(), oldTodo = await receiver.localTodoApi.create({ title: 'old unsaved form target', ddl: '2040-02-01T09:00' })
  const before = await receiver.readLocalState()
  await receiver.restoreConfirmed(await receiver.previewRestore(snapshot))
  const restored = await receiver.readLocalState()
  assert.ok(restored.todos[0].id >= before.nextId)
  assert.notEqual(restored.todos[0].id, oldTodo.id)
  assert.equal(restored.todos[0].publicId, snapshot.data.todos[0].id)
  await assert.rejects(receiver.localTodoApi.update(oldTodo.id, { title: 'stale form must not overwrite imported todo', ddl: '2040-03-01T09:00' }), /不存在/)
  assert.deepEqual(normal(await receiver.readLocalState()), normal(restored))
})
