import { legacyNames as brandLegacyNames } from '../../../../shared/brandCompatibility.mjs'
import { createEmptyLocalState, newPublicId, type LocalState } from '../types'
import { validateLocalState } from '../validation'

export const SNAPSHOT_MAX_BYTES = 7 * 1024 * 1024
export const LEGACY_SNAPSHOT_SCOPE = 'core-without-ai-history-v1'
export const SNAPSHOT_SCOPE = 'core-with-daily-v2'
export type SnapshotValue =
  string | number | boolean | null | SnapshotValue[] | { [key: string]: SnapshotValue }
export type SnapshotRecord = Record<string, SnapshotValue>
export const LEGACY_COLLECTION_FIELDS = {
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
export const COLLECTION_FIELDS = {
  ...LEGACY_COLLECTION_FIELDS,
  todos: [...LEGACY_COLLECTION_FIELDS.todos, 'dailyVersion'],
  dayEntries: [
    'kind',
    'plannedDate',
    'initialDate',
    'origin',
    'position',
    'isPriority',
    'version',
    'createdAt',
    'updatedAt',
    'creationOperationId',
    'titleSnapshot',
    'title',
    'completed',
    'todoPublicId',
  ],
  dailyEvents: [
    'operationId',
    'kind',
    'targetKind',
    'targetPublicId',
    'entryPublicId',
    'attributedDate',
    'recordedAt',
    'occurredAt',
    'source',
    'titleSnapshot',
    'origin',
    'fromDate',
    'toDate',
    'previousEventId',
    'targetVersion',
    'priorityBefore',
    'priorityAfter',
  ],
  // The local "already asked yesterday" preference is intentionally not cloud business data.
  dailyReviews: ['date', 'version', 'saved', 'draft'],
} as const
export type CollectionName = keyof typeof COLLECTION_FIELDS
type LegacyCollectionName = keyof typeof LEGACY_COLLECTION_FIELDS
interface SnapshotBase {
  format: 'kexu-local-snapshot' | typeof brandLegacyNames.logicalSnapshot
  snapshotId: string
  createdAt: string
  source: { datasetId: string; revision: number }
}
export interface LogicalSnapshotV1 extends SnapshotBase {
  version: 1
  schemaVersion: 1
  scope: typeof LEGACY_SNAPSHOT_SCOPE
  data: Record<LegacyCollectionName, SnapshotRecord[]>
}
export interface LogicalSnapshotV2 extends SnapshotBase {
  version: 2
  schemaVersion: 2
  scope: typeof SNAPSHOT_SCOPE
  data: Record<CollectionName, SnapshotRecord[]>
}
export type LogicalSnapshot = LogicalSnapshotV1 | LogicalSnapshotV2

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const references: Record<string, LegacyCollectionName> = {
  scheduleId: 'schedules',
  courseId: 'courses',
  examId: 'exams',
  recurringId: 'recurringRules',
  todoId: 'todos',
}
const names = Object.keys(COLLECTION_FIELDS) as CollectionName[]
const legacyNames = Object.keys(LEGACY_COLLECTION_FIELDS) as LegacyCollectionName[]
const numericCollections = new Set<CollectionName>([
  'schedules',
  'courses',
  'exams',
  'todos',
  'recurringRules',
])
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('快照对象格式无效')
  return value as Record<string, unknown>
}
const noExtra = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('快照包含不支持的字段，请先确认导出格式')
}
const rowsFor = (snapshot: LogicalSnapshot, name: CollectionName): SnapshotRecord[] =>
  (snapshot.data as Partial<Record<CollectionName, SnapshotRecord[]>>)[name] ?? []

function reviewContent(input: unknown, saved: boolean) {
  if (input === null) return
  const content = object(input)
  noExtra(
    content,
    saved
      ? [
          'feeling',
          'text',
          'nextStep',
          'savedAt',
          'fingerprint',
          'summary',
          'facts',
          'algorithmVersion',
        ]
      : ['feeling', 'text', 'nextStep', 'updatedAt'],
  )
  for (const [key, value] of Object.entries(content)) {
    if (saved && key === 'facts') {
      const facts = object(value)
      if (
        Object.keys(facts).length > 40 ||
        Object.entries(facts).some(
          ([name, count]) =>
            !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(name) ||
            !Number.isSafeInteger(count) ||
            Number(count) < 0,
        )
      )
        throw new Error('回顾事实计数无效')
    } else if (typeof value !== 'string' || value.length > 4096) {
      throw new Error('回顾含无效字段值或过长文本')
    }
  }
}

/** Explicit whitelist: never serialize the whole database or browser settings. */
export function createLogicalSnapshot(state: LocalState): LogicalSnapshotV2 {
  const maps = Object.fromEntries(
    legacyNames.map((name) => [
      name,
      new Map(
        (state[name] as unknown as Record<string, unknown>[]).map((row) => [row.id, row.publicId]),
      ),
    ]),
  ) as Record<LegacyCollectionName, Map<unknown, unknown>>
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
        if (name === 'dailyReviews') {
          // Nested review content has its own allowlist; do not leak future UI metadata.
          for (const part of ['saved', 'draft'] as const) {
            if (record[part] == null) continue
            const content = object(record[part])
            const fields =
              part === 'saved'
                ? [
                    'feeling',
                    'text',
                    'nextStep',
                    'savedAt',
                    'fingerprint',
                    'summary',
                    'facts',
                    'algorithmVersion',
                  ]
                : ['feeling', 'text', 'nextStep', 'updatedAt']
            record[part] = Object.fromEntries(
              fields.filter((key) => content[key] !== undefined).map((key) => [key, content[key]]),
            )
          }
        }
        return record
      }),
    ]),
  ) as LogicalSnapshotV2['data']
  return validateLogicalSnapshot({
    format: 'kexu-local-snapshot',
    version: 2,
    schemaVersion: 2,
    scope: SNAPSHOT_SCOPE,
    snapshotId: newPublicId(),
    createdAt: new Date().toISOString(),
    source: { datasetId: state.datasetId, revision: state.revision },
    data,
  }) as LogicalSnapshotV2
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
  const legacy =
    value.version === 1 && value.schemaVersion === 1 && value.scope === LEGACY_SNAPSHOT_SCOPE
  const current = value.version === 2 && value.schemaVersion === 2 && value.scope === SNAPSHOT_SCOPE
  if (!['kexu-local-snapshot', brandLegacyNames.logicalSnapshot].includes(value.format as string) || (!legacy && !current))
    throw new Error('仅支持本应用核心逻辑快照 v1/v2；旧 H2 备份不能在此恢复')
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
  const data = object(value.data),
    expectedNames = legacy ? legacyNames : names
  noExtra(data, expectedNames)
  const maps = {} as Record<CollectionName, Set<string>>,
    allIds = new Set<string>()
  for (const name of expectedNames) {
    const rows = data[name]
    if (!Array.isArray(rows) || rows.length > 50_000) throw new Error('快照集合缺失或数量过多')
    maps[name] = new Set()
    for (const item of rows) {
      const row = object(item)
      const fields = legacy
        ? LEGACY_COLLECTION_FIELDS[name as LegacyCollectionName]
        : COLLECTION_FIELDS[name]
      noExtra(row, ['id', ...fields])
      if (typeof row.id !== 'string' || !uuid.test(row.id) || allIds.has(row.id))
        throw new Error('快照存在无效或重复 UUID')
      maps[name].add(row.id)
      allIds.add(row.id)
      for (const [key, itemValue] of Object.entries(row)) {
        if (name === 'dailyReviews' && (key === 'saved' || key === 'draft')) {
          reviewContent(itemValue, key === 'saved')
          continue
        }
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
  const eventsById = new Map(
    ((data.dailyEvents ?? []) as Record<string, unknown>[]).map((event) => [event.id, event]),
  )
  for (const name of expectedNames)
    for (const item of data[name] as Record<string, unknown>[]) {
      for (const [key, target] of Object.entries(references))
        if (key in item && item[key] !== null && !maps[target].has(String(item[key])))
          throw new Error('快照包含悬空关联，不能恢复')
      // Event targets and todo/day-entry references are archive UUIDs and may outlive their source.
      if (name === 'dailyEvents' && item.previousEventId != null) {
        const previous = eventsById.get(item.previousEventId)
        if (
          !previous ||
          previous.targetKind !== item.targetKind ||
          previous.targetPublicId !== item.targetPublicId
        )
          throw new Error('快照包含悬空或不同目标的原事件关联')
      }
    }
  if (new TextEncoder().encode(JSON.stringify(value)).length > SNAPSHOT_MAX_BYTES)
    throw new Error('快照超过 7 MB 本地大小限制；请导出归档后再重试，不会自动丢弃历史记录')
  const snapshot = structuredClone(value) as unknown as LogicalSnapshot
  // Apply the same semantic validation as a live write, including nested daily data and dates.
  validateLocalState(materializeUnchecked(snapshot, createEmptyLocalState()))
  return snapshot
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

function materializeUnchecked(snapshot: LogicalSnapshot, current: LocalState): LocalState {
  // Numeric IDs never repeat across restore; archive/public UUIDs remain stable.
  let nextId = current.nextId
  const maps = {} as Record<CollectionName, Map<string, number>>
  for (const name of names)
    maps[name] = new Map(rowsFor(snapshot, name).map((row) => [String(row.id), nextId++]))
  const collections = Object.fromEntries(
    names.map((name) => [
      name,
      rowsFor(snapshot, name).map((row) => {
        const record: Record<string, unknown> = { ...row, publicId: row.id }
        if (numericCollections.has(name)) record.id = maps[name].get(String(row.id))
        else delete record.id
        if (name === 'dailyReviews') record.promptedYesterday = false
        for (const [key, target] of Object.entries(references))
          if (key in record && record[key] !== null)
            record[key] = maps[target].get(String(record[key]))
        return record
      }),
    ]),
  )
  // Identity belongs to the receiver; its restore generation is never copied from the sender.
  return {
    ...current,
    ...collections,
    schemaVersion: 2,
    dataGeneration: newPublicId(),
    nextId,
    conversations: [],
    messages: [],
  } as LocalState
}

export function materializeSnapshot(snapshot: LogicalSnapshot, current: LocalState): LocalState {
  return materializeUnchecked(validateLogicalSnapshot(snapshot), current)
}

export function snapshotCounts(snapshot: LogicalSnapshot): Record<CollectionName, number> {
  return Object.fromEntries(names.map((name) => [name, rowsFor(snapshot, name).length])) as Record<
    CollectionName,
    number
  >
}
