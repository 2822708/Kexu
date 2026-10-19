import type { LocalState, LocalTodo } from '../types'

export type DailyOrigin = 'planned' | 'adHoc' | 'backfill'
export interface DayEntryBase {
  publicId: string
  plannedDate: string
  initialDate: string
  origin: DailyOrigin
  position: number
  isPriority: boolean
  version: number
  createdAt: string
  updatedAt: string
  creationOperationId: string
  /** Source deletion keeps this archive readable. */
  titleSnapshot: string
}
export type DayEntry = DayEntryBase &
  ({ kind: 'dayTask'; title: string; completed: boolean } | { kind: 'todo'; todoPublicId: string })
export type DailyEventKind =
  | 'create'
  | 'plan'
  | 'complete'
  | 'undo'
  | 'priority'
  | 'move'
  | 'convert'
  | 'activity'
  | 'courseComplete'
  | 'courseUndo'
  | 'reviewDraft'
  | 'reviewSave'
  | 'reviewDiscard'
  | 'reviewPrompt'
export interface DailyEvent {
  publicId: string
  operationId: string
  kind: DailyEventKind
  targetKind: 'dayTask' | 'todo' | 'course' | 'review' | 'day'
  targetPublicId: string
  entryPublicId: string | null
  attributedDate: string
  recordedAt: string
  occurredAt: string | null
  source: 'manual' | 'backfill' | 'system' | 'legacyUnknown'
  titleSnapshot: string
  origin: DailyOrigin | null
  fromDate: string | null
  toDate: string | null
  previousEventId: string | null
  targetVersion: number
  priorityBefore?: boolean | null
  priorityAfter?: boolean | null
}
export interface DailyReviewContent {
  feeling: string
  text: string
  nextStep: string
}
export interface DailyReview {
  publicId: string
  date: string
  version: number
  saved:
    | (DailyReviewContent & {
        savedAt: string
        fingerprint: string
        summary: string
        facts: Record<string, number>
        algorithmVersion: string
      })
    | null
  draft: (DailyReviewContent & { updatedAt: string }) | null
  promptedYesterday: boolean
}
export interface DailyCommandContext {
  expectedGeneration: string
  operationId: string
  /** Editing history is always an explicit action; future completion remains forbidden. */
  allowPast?: boolean
}
export interface DailyCommandResult {
  changed: boolean
  operationId: string
  entryPublicId?: string
  completionEventId?: string
}
export interface DailyResolvedEntry {
  publicId: string
  kind: 'dayTask' | 'todo'
  plannedDate: string
  initialDate: string
  origin: DailyOrigin
  title: string
  completed: boolean
  version: number
  isPriority: boolean
  position: number
  ddl: string | null
  missingSource: boolean
  completedDate: string | null
  todoPublicId?: string
  examLinked: boolean
}
export interface DailyWorkspace {
  state: LocalState
  date: string
  generation: string
  entries: DailyResolvedEntry[]
  candidateTodos: LocalTodo[]
  /** All remaining independent tasks across dates; moving is explicit. */
  unfinishedEntries: DailyResolvedEntry[]
}
