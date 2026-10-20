import { legacyNames } from '../../shared/brandCompatibility.mjs'
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
      fileName: url.pathname.endsWith('.mjs') ? 'compat.js' : 'source.ts',
      compilerOptions: {
        allowJs: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
    vm.runInContext(`(function(module,exports,require){${compiled}\n})`, context, {
      filename: url.pathname,
    })(module, module.exports, (name) => {
      if (!name.startsWith('.')) return nativeRequire(name)
      const target = new URL(/\.[cm]?[jt]sx?$/.test(name) ? name : `${name}.ts`, url)
      if (target.pathname.endsWith('/local/mode.ts'))
        return { NATIVE_SHELL: true, LOCAL_MODE: true }
      return loadSource(target)
    })
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
    ...load('local/daily/commands'),
    ...load('local/daily/review'),
    ...load('backup/coordinator'),
    storage: load('backup/storage'),
    indexedDB,
    load,
  }
}
const normal = (value) => JSON.parse(JSON.stringify(value))

test('Kexu keeps the original IndexedDB identities and reads old logical snapshots without replacing local data', async () => {
  const x = setup()
  const state = await populated(x)
  assert.equal(x.LOCAL_DATABASE_NAME, legacyNames.localDatabase)
  const snapshot = { ...normal(x.createLogicalSnapshot(state)), format: legacyNames.logicalSnapshot }
  const preview = await x.previewRestore(snapshot)
  assert.ok(preview)
  assert.deepEqual(normal(await x.readLocalState()), normal(state))
  await x.closeLocalStore()
  assert.deepEqual(normal(await x.readLocalState()), normal(state))
  assert.equal(x.createLogicalSnapshot(state).format, 'kexu-local-snapshot')
})

test('old encrypted snapshots authenticate their exact original AAD; renamed exports use Kexu identifiers', async () => {
  const x = setup(), state = await populated(x), rawKey = x.generateBackupKey()
  const snapshot = { ...normal(x.createLogicalSnapshot(state)), format: legacyNames.logicalSnapshot }
  const bytes = x.fromBase64(rawKey)
  const keyId = (await x.sha256(bytes)).slice(0, 32)
  // Independent previous-release encoder: changing the format before decrypting would break GCM.
  const header = {
    format: legacyNames.encryptedSnapshot, version: 1, snapshotId: snapshot.snapshotId,
    datasetId: snapshot.source.datasetId, revision: snapshot.source.revision,
    createdAt: snapshot.createdAt, algorithm: 'AES-GCM-256', keyId,
  }
  const key = await webcrypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt'])
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(JSON.stringify(header)), tagLength: 128 }, key,
    new TextEncoder().encode(JSON.stringify(snapshot)))
  const envelope = { ...header, iv: x.toBase64(iv), ciphertext: x.toBase64(new Uint8Array(ciphertext)) }
  assert.deepEqual(normal(await x.decryptSnapshot(envelope, rawKey)), snapshot)
  await assert.rejects(x.decryptSnapshot({ ...envelope, format: 'kexu-encrypted-snapshot' }, rawKey), /解密失败/)
  const next = await x.encryptSnapshot(x.createLogicalSnapshot(state), rawKey)
  assert.equal(next.format, 'kexu-encrypted-snapshot')
  assert.equal((await x.decryptSnapshot(next, rawKey)).format, 'kexu-local-snapshot')
})

test('old recovery credentials retain their vault/token/key and export the new credential format', async () => {
  const x = setup(), key = x.generateBackupKey()
  const oldCredential = { format: legacyNames.cloudRecovery, version: 1,
    serverUrl: 'https://backup.example.test', vaultId: webcrypto.randomUUID(), token: 'A'.repeat(43), key }
  await x.importRecoveryCredential(oldCredential)
  const current = await x.exportRecoveryCredential()
  assert.deepEqual(normal(current), { ...oldCredential, format: 'kexu-cloud-recovery' })
  const persisted = await x.storage.readBackupState()
  assert.equal(persisted.config.key, key)
  assert.equal(persisted.config.enabled, false, 'import never starts automatic restore or backup')
})
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
  await assert.rejects(x.previewRestore({ format: 'kexu-h2-backup' }), /核心逻辑快照/)
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
    const request = x.indexedDB.open(legacyNames.backupDatabase, 1)
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
  const receiver = setup(),
    oldTodo = await receiver.localTodoApi.create({
      title: 'old unsaved form target',
      ddl: '2040-02-01T09:00',
    })
  const before = await receiver.readLocalState()
  await receiver.restoreConfirmed(await receiver.previewRestore(snapshot))
  const restored = await receiver.readLocalState()
  assert.ok(restored.todos[0].id >= before.nextId)
  assert.notEqual(restored.todos[0].id, oldTodo.id)
  assert.equal(restored.todos[0].publicId, snapshot.data.todos[0].id)
  await assert.rejects(
    receiver.localTodoApi.update(oldTodo.id, {
      title: 'stale form must not overwrite imported todo',
      ddl: '2040-03-01T09:00',
    }),
    /不存在/,
  )
  assert.deepEqual(normal(await receiver.readLocalState()), normal(restored))
})

async function populatedDaily(x) {
  await populated(x)
  const state = await x.readLocalState(),
    date = x.nowLocalDateTime().slice(0, 10)
  const context = () => ({
    expectedGeneration: state.dataGeneration,
    operationId: webcrypto.randomUUID(),
  })
  const created = await x.dailyApi.createTask({
    ...context(),
    date,
    title: '临时完成一件事',
    isPriority: true,
  })
  await x.dailyApi.planTodo({
    ...context(),
    date,
    todoPublicId: state.todos.find((todo) => todo.examId == null).publicId,
  })
  const completed = await x.dailyApi.setCompleted({
    ...context(),
    entryPublicId: created.entryPublicId,
    expectedVersion: 0,
    completed: true,
  })
  const facts = x.projectDailyReview(await x.readLocalState(), date)
  await x.dailyApi.saveReview({
    ...context(),
    date,
    expectedVersion: 0,
    content: { feeling: '踏实', text: '完成一件具体的事', nextStep: '再走一小步' },
    facts,
  })
  await x.dailyApi.saveReviewDraft({
    ...context(),
    date,
    expectedVersion: 1,
    content: { feeling: '平静', text: '尚未提交的新想法', nextStep: '明天先读两页' },
  })
  return { state: await x.readLocalState(), date, created, completed, context }
}

function asLegacySnapshot(snapshot) {
  const legacy = normal(snapshot)
  legacy.version = 1
  legacy.schemaVersion = 1
  legacy.scope = 'core-without-ai-history-v1'
  delete legacy.data.dayEntries
  delete legacy.data.dailyEvents
  delete legacy.data.dailyReviews
  for (const todo of legacy.data.todos) delete todo.dailyVersion
  return legacy
}

test('v1 plain and encrypted snapshots restore into schema2 without fabricating daily activity or changing recovery keys', async () => {
  const source = setup(),
    daily = await populatedDaily(source)
  const legacy = asLegacySnapshot(source.createLogicalSnapshot(daily.state)),
    key = source.generateBackupKey()
  const envelope = await source.encryptSnapshot(legacy, key)
  assert.equal(envelope.version, 1)
  assert.equal(envelope.algorithm, 'AES-GCM-256')
  const snapshot = await source.decryptSnapshot(envelope, key)
  assert.equal(snapshot.version, 1)
  const receiver = setup(),
    before = await receiver.initializeLocalStore()
  const preview = await receiver.previewRestore(
    receiver.parseLogicalSnapshot(JSON.stringify(snapshot)),
  )
  assert.equal(preview.snapshot.version, 1)
  assert.equal(preview.counts.dayEntries, 0)
  assert.equal(preview.counts.dailyEvents, 0)
  assert.equal(preview.counts.dailyReviews, 0)
  await receiver.restoreConfirmed(preview)
  const restored = await receiver.readLocalState()
  assert.equal(restored.schemaVersion, 2)
  assert.notEqual(restored.dataGeneration, before.dataGeneration)
  assert.deepEqual(normal(restored.dayEntries), [])
  assert.deepEqual(normal(restored.dailyEvents), [])
  assert.deepEqual(normal(restored.dailyReviews), [])
  assert.deepEqual(
    restored.todos.map((todo) => todo.completed),
    daily.state.todos.map((todo) => todo.completed),
  )
  assert.equal(receiver.createLogicalSnapshot(restored).version, 2)
})

test('snapshot2 round trip preserves daily UUID references, saved review and independent draft; display preference stays local', async () => {
  const source = setup(),
    daily = await populatedDaily(source)
  await source.mutateLocalState((state) => {
    state.dailyReviews[0].promptedYesterday = true
    state.dailyReviews[0].saved.secretUiField = 'DO-NOT-EXPORT-UI-METADATA'
  })
  const snapshot = source.createLogicalSnapshot(await source.readLocalState())
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.schemaVersion, 2)
  assert.equal(snapshot.scope, 'core-with-daily-v2')
  assert.equal(
    snapshot.data.dayEntries.find((entry) => entry.kind === 'todo').todoPublicId,
    snapshot.data.todos.find((todo) => todo.examId == null).id,
  )
  assert.equal(JSON.stringify(snapshot).includes('promptedYesterday'), false)
  assert.equal(JSON.stringify(snapshot).includes('DO-NOT-EXPORT-UI-METADATA'), false)
  assert.equal(JSON.stringify(snapshot).includes('dataGeneration'), false)
  assert.equal(snapshot.data.dailyReviews[0].saved.text, '完成一件具体的事')
  assert.equal(snapshot.data.dailyReviews[0].draft.text, '尚未提交的新想法')
  const receiver = setup(),
    before = await receiver.initializeLocalStore()
  const key = source.generateBackupKey(),
    envelope = await source.encryptSnapshot(snapshot, key)
  const decoded = await receiver.decryptSnapshot(envelope, key)
  await receiver.restoreConfirmed(await receiver.previewRestore(decoded))
  const restored = await receiver.readLocalState()
  assert.equal(restored.datasetId, before.datasetId)
  assert.notEqual(restored.dataGeneration, before.dataGeneration)
  assert.notEqual(restored.dataGeneration, daily.state.dataGeneration)
  assert.equal(restored.dailyReviews[0].promptedYesterday, false)
  const date = restored.dailyReviews[0].date
  assert.equal(
    receiver.projectDailyReview(restored, date).fingerprint,
    source.projectDailyReview(daily.state, date).fingerprint,
    'snapshot key reconstruction must not make unchanged facts stale',
  )
  assert.deepEqual(normal(receiver.createLogicalSnapshot(restored).data), normal(snapshot.data))
})

test('snapshot2 rejects missing collections, duplicate daily records, malformed UUIDs, invalid events and nested secret fields', async () => {
  const x = setup(),
    daily = await populatedDaily(x),
    snapshot = x.createLogicalSnapshot(daily.state)
  const cases = [
    [(value) => delete value.data.dailyEvents, /集合缺失/],
    [
      (value) => {
        value.schemaVersion = 1
      },
      /核心逻辑快照/,
    ],
    [
      (value) => {
        value.data.dayEntries.find((entry) => entry.kind === 'todo').todoPublicId = 'not-a-uuid'
      },
      /引用/,
    ],
    [
      (value) => {
        const entry = value.data.dayEntries.find((entry) => entry.kind === 'todo')
        value.data.dayEntries.push({ ...entry, id: webcrypto.randomUUID() })
      },
      /重复选入/,
    ],
    [
      (value) => {
        value.data.dayEntries.find((entry) => entry.kind === 'todo').completed = true
      },
      /引用/,
    ],
    [
      (value) => {
        value.data.dailyEvents[0].previousEventId = webcrypto.randomUUID()
      },
      /悬空/,
    ],
    [
      (value) => {
        value.data.dailyEvents[0].previousEventId = value.data.dailyEvents[1].id
      },
      /不同目标/,
    ],
    [
      (value) => {
        value.data.dailyEvents[0].kind = 'invent-score'
      },
      /事件类型/,
    ],
    [
      (value) => {
        value.data.dailyReviews[0].saved.secret = 'forbidden'
      },
      /不支持的字段/,
    ],
    [
      (value) => {
        value.data.dailyReviews[0].saved.facts.completed = -1
      },
      /事实计数/,
    ],
    [
      (value) => {
        value.data.dailyReviews[0].date = '2026-02-30'
      },
      /回顾日期/,
    ],
    [
      (value) => {
        value.data.dayEntries[0].id = value.data.todos[0].id
      },
      /重复 UUID/,
    ],
  ]
  for (const [change, expected] of cases) {
    const invalid = normal(snapshot)
    change(invalid)
    await assert.rejects(x.previewRestore(invalid), expected)
  }
  assert.deepEqual(normal(await x.readLocalState()), normal(daily.state))
})

test('archive UUIDs remain recoverable after source todo deletion and retain their truthful daily facts', async () => {
  const source = setup(),
    daily = await populatedDaily(source)
  const todo = daily.state.todos.find((item) => item.examId == null)
  await source.localTodoApi.remove(todo.id)
  const snapshot = source.createLogicalSnapshot(await source.readLocalState())
  assert.ok(
    snapshot.data.dayEntries.some(
      (entry) => entry.kind === 'todo' && entry.todoPublicId === todo.publicId,
    ),
  )
  const receiver = setup()
  await receiver.restoreConfirmed(await receiver.previewRestore(snapshot))
  const workspace = await receiver.dailyApi.readWorkspace(daily.date)
  const archived = workspace.entries.find((entry) => entry.todoPublicId === todo.publicId)
  assert.equal(archived.missingSource, true)
  assert.equal(archived.title, todo.title)
})

test('restoring the same dataset invalidates previously captured daily complete, undo and review commands', async () => {
  const x = setup(),
    daily = await populatedDaily(x),
    snapshot = x.createLogicalSnapshot(daily.state)
  const oldContext = daily.context()
  await x.restoreConfirmed(await x.previewRestore(snapshot))
  const restored = await x.readLocalState()
  assert.equal(restored.datasetId, daily.state.datasetId)
  assert.notEqual(restored.dataGeneration, daily.state.dataGeneration)
  await assert.rejects(
    x.dailyApi.setCompleted({
      ...oldContext,
      entryPublicId: daily.created.entryPublicId,
      completed: false,
      expectedVersion: 1,
      undoOf: daily.completed.completionEventId,
    }),
    /已恢复或替换/,
  )
  await assert.rejects(
    x.dailyApi.setCompleted({
      ...daily.context(),
      entryPublicId: daily.created.entryPublicId,
      completed: true,
      expectedVersion: 1,
    }),
    /已恢复或替换/,
  )
  await assert.rejects(
    x.dailyApi.saveReviewDraft({
      ...daily.context(),
      date: daily.date,
      expectedVersion: 2,
      content: { feeling: '', text: '旧页面不应保存', nextStep: '' },
    }),
    /已恢复或替换/,
  )
  assert.deepEqual(normal(await x.readLocalState()), normal(restored))
})

test('daily history near the 7 MB limit remains intact, and oversized snapshots stop without silently dropping events', async () => {
  let exportRequest
  const nativePort = {
    postMessage: (text) => {
      exportRequest = JSON.parse(text)
    },
  }
  const x = setup({
      window: {
        location: { origin: 'https://appassets.androidplatform.net' },
        KexuNative: nativePort,
      },
    }),
    daily = await populatedDaily(x),
    snapshot = x.createLogicalSnapshot(daily.state)
  const sample = {
    ...snapshot.data.dailyEvents[0],
    titleSnapshot: '实'.repeat(500),
    previousEventId: null,
  }
  const rowBytes = Buffer.byteLength(JSON.stringify(sample)) + 1
  const baseBytes = Buffer.byteLength(JSON.stringify(snapshot))
  const count = Math.floor((x.SNAPSHOT_MAX_BYTES - baseBytes - 16_384) / rowBytes)
  const makeEvent = () => ({
    ...sample,
    id: webcrypto.randomUUID(),
    operationId: webcrypto.randomUUID(),
  })
  snapshot.data.dailyEvents = Array.from({ length: count }, makeEvent)
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 6 * 1024 * 1024)
  const valid = x.validateLogicalSnapshot(snapshot)
  const state = x.materializeSnapshot(valid, x.createEmptyLocalState())
  assert.equal(x.createLogicalSnapshot(state).data.dailyEvents.length, count)
  assert.ok(Buffer.byteLength(JSON.stringify(valid, null, 2)) > x.SNAPSHOT_MAX_BYTES)
  const exported = x.load('platform/saveJson').saveJsonFile(valid, 'near-limit.json')
  assert.equal(exportRequest.text, JSON.stringify(valid))
  assert.equal(x.parseLogicalSnapshot(exportRequest.text).data.dailyEvents.length, count)
  nativePort.onmessage({
    data: JSON.stringify({ type: 'save-json-result', id: exportRequest.id, ok: true }),
  })
  assert.equal(await exported, true)
  snapshot.data.dailyEvents.push(
    ...Array.from({ length: Math.ceil(32_768 / rowBytes) + 20 }, makeEvent),
  )
  const oversizedCount = snapshot.data.dailyEvents.length
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > x.SNAPSHOT_MAX_BYTES)
  assert.throws(() => x.validateLogicalSnapshot(snapshot), /7 MB/)
  assert.equal(snapshot.data.dailyEvents.length, oversizedCount)
  assert.deepEqual(normal(await x.readLocalState()), normal(daily.state))
})
