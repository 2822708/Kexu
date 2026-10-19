import type { LocalState } from '../types'

export const SNAPSHOT_MAX_BYTES = 7 * 1024 * 1024
export const SNAPSHOT_SCOPE = 'core-without-ai-history-v1'
export type SnapshotRecord = Record<string, string | number | boolean | null | number[]>
export const COLLECTION_FIELDS = {
  schedules: ['name', 'periodStartDate', 'periodEndDate', 'createdAt', 'updatedAt'],
  courses: [
    'scheduleId',
    'name',
    'location',
    'teacher',
    'dayOfWeek',
    'startPeriod',
    'endPeriod',
    'weeks',
    'createdAt',
    'updatedAt',
  ],
  exams: [
    'scheduleId',
    'name',
    'location',
    'examDate',
    'startTime',
    'endTime',
    'createdAt',
    'updatedAt',
  ],
  todos: [
    'title',
    'ddl',
    'completed',
    'recurringId',
    'examId',
    'chainGenerated',
    'createdAt',
    'updatedAt',
  ],
  periods: ['periodNumber', 'startTime', 'endTime', 'category'],
  recurringRules: [
    'title',
    'frequency',
    'dayOfWeek',
    'dayOfMonth',
    'triggerTime',
    'script',
    'ddlOffsetMinutes',
    'enabled',
    'chainAfterComplete',
    'lastTriggeredAt',
    'nextTriggerAt',
  ],
  recurringOccurrences: ['recurringId', 'scheduledAt', 'todoId'],
  focusCompletions: ['scheduleId', 'courseId', 'date', 'completed'],
} as const
export type CollectionName = keyof typeof COLLECTION_FIELDS
export interface LogicalSnapshot {
  format: 'tangent-local-snapshot'
  version: 1
  schemaVersion: 1
  scope: typeof SNAPSHOT_SCOPE
  snapshotId: string
  createdAt: string
  source: { datasetId: string; revision: number }
  data: Record<CollectionName, SnapshotRecord[]>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const references: Record<string, CollectionName> = {
  scheduleId: 'schedules',
  courseId: 'courses',
  examId: 'exams',
  recurringId: 'recurringRules',
  todoId: 'todos',
}
const names = Object.keys(COLLECTION_FIELDS) as CollectionName[]
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('快照对象格式无效')
  return value as Record<string, unknown>
}
const noExtra = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('快照包含不支持的字段，请先确认导出格式')
}

/** Explicit whitelist: never serialize the whole database or browser settings. */
export function createLogicalSnapshot(state: LocalState): LogicalSnapshot {
  const maps = Object.fromEntries(
    names.map((name) => [
      name,
      new Map(
        (state[name] as unknown as Record<string, unknown>[]).map((row) => [row.id, row.publicId]),
      ),
    ]),
  ) as Record<CollectionName, Map<unknown, unknown>>
  const data = Object.fromEntries(
    names.map((name) => [
      name,
      (state[name] as unknown as Record<string, unknown>[]).map((row) => {
        const record: Record<string, unknown> = { id: row.publicId }
        for (const field of COLLECTION_FIELDS[name]) {
          const value = row[field]
          if (value === undefined) continue
          record[field] =
            references[field] && value !== null ? maps[references[field]].get(value) : value
          if (references[field] && value !== null && record[field] === undefined)
            throw new Error('本地关联不完整，暂时无法导出快照')
        }
        return record
      }),
    ]),
  ) as LogicalSnapshot['data']
  const snapshot: LogicalSnapshot = {
    format: 'tangent-local-snapshot',
    version: 1,
    schemaVersion: 1,
    scope: SNAPSHOT_SCOPE,
    snapshotId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: { datasetId: state.datasetId, revision: state.revision },
    data,
  }
  return validateLogicalSnapshot(snapshot)
}

export function validateLogicalSnapshot(input: unknown): LogicalSnapshot {
  const value = object(input)
  noExtra(value, [
    'format',
    'version',
    'schemaVersion',
    'scope',
    'snapshotId',
    'createdAt',
    'source',
    'data',
  ])
  if (
    value.format !== 'tangent-local-snapshot' ||
    value.version !== 1 ||
    value.schemaVersion !== 1 ||
    value.scope !== SNAPSHOT_SCOPE
  )
    throw new Error('仅支持本应用核心逻辑快照 v1；旧 H2 备份不能在此恢复')
  if (
    !uuid.test(String(value.snapshotId)) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error('快照标识或时间无效')
  const source = object(value.source)
  noExtra(source, ['datasetId', 'revision'])
  if (
    !uuid.test(String(source.datasetId)) ||
    !Number.isSafeInteger(source.revision) ||
    Number(source.revision) < 0
  )
    throw new Error('快照来源无效')
  const data = object(value.data)
  noExtra(data, names)
  const maps = {} as Record<CollectionName, Set<string>>
  for (const name of names) {
    const rows = data[name]
    if (!Array.isArray(rows) || rows.length > 50_000) throw new Error('快照集合缺失或数量过多')
    maps[name] = new Set()
    for (const item of rows) {
      const row = object(item)
      noExtra(row, ['id', ...COLLECTION_FIELDS[name]])
      if (typeof row.id !== 'string' || !uuid.test(row.id) || maps[name].has(row.id))
        throw new Error('快照存在无效或重复 UUID')
      maps[name].add(row.id)
      for (const [key, itemValue] of Object.entries(row)) {
        if (itemValue === null || typeof itemValue === 'boolean') continue
        if (typeof itemValue === 'string' && itemValue.length <= (key === 'script' ? 20_000 : 4096))
          continue
        if (typeof itemValue === 'number' && Number.isSafeInteger(itemValue)) continue
        if (
          key === 'weeks' &&
          Array.isArray(itemValue) &&
          itemValue.length <= 104 &&
          itemValue.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 104)
        )
          continue
        throw new Error('快照含无效字段值或过长文本')
      }
    }
  }
  for (const name of names) {
    for (const item of data[name] as Record<string, unknown>[]) {
      for (const [key, target] of Object.entries(references)) {
        if (key in item && item[key] !== null && !maps[target].has(String(item[key])))
          throw new Error('快照包含悬空关联，不能恢复')
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > SNAPSHOT_MAX_BYTES)
    throw new Error('快照超过 7 MB 本地大小限制')
  return structuredClone(value) as unknown as LogicalSnapshot
}

export function parseLogicalSnapshot(text: string): LogicalSnapshot {
  if (new TextEncoder().encode(text).length > SNAPSHOT_MAX_BYTES)
    throw new Error('快照文件超过大小限制')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('快照文件不是有效 JSON')
  }
  return validateLogicalSnapshot(value)
}

export function materializeSnapshot(snapshot: LogicalSnapshot, current: LocalState): LocalState {
  validateLogicalSnapshot(snapshot)
  // Never reuse receiver IDs: another tab may still hold an unsaved form for an old ID.
  // Stable public UUIDs survive restore, while stale numeric references safely become missing.
  let nextId = current.nextId
  const maps = {} as Record<CollectionName, Map<string, number>>
  for (const name of names)
    maps[name] = new Map(snapshot.data[name].map((row) => [String(row.id), nextId++]))
  const collections = Object.fromEntries(
    names.map((name) => [
      name,
      snapshot.data[name].map((row) => {
        const record: Record<string, unknown> = { ...row, publicId: row.id }
        if (name === 'periods' || name === 'focusCompletions' || name === 'recurringOccurrences')
          delete record.id
        else record.id = maps[name].get(String(row.id))
        for (const [key, target] of Object.entries(references))
          if (key in record && record[key] !== null)
            record[key] = maps[target].get(String(record[key]))
        return record
      }),
    ]),
  )
  // Keep receiver identity; old AI proposals must not attach to newly assigned local IDs.
  return { ...current, ...collections, nextId, conversations: [], messages: [] } as LocalState
}

export function snapshotCounts(snapshot: LogicalSnapshot): Record<CollectionName, number> {
  return Object.fromEntries(names.map((name) => [name, snapshot.data[name].length])) as Record<
    CollectionName,
    number
  >
}
