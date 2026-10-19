import type { LocalState } from '../types'
import type { DailyEvent, DailyResolvedEntry, DailyReview } from './types'

/** ISO business day, intentionally independent of the device's local timezone. */
export function dailyBusinessDate(value: string | Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isActiveDailySource(event: DailyEvent): boolean {
  return event.source === 'manual' || event.source === 'backfill'
}

export function dailyTargetKey(
  event: Pick<DailyEvent, 'targetKind' | 'targetPublicId' | 'attributedDate'>,
): string {
  return `${event.targetKind}:${event.targetPublicId}${event.targetKind === 'course' ? `:${event.attributedDate}` : ''}`
}

/** Events are appended inside the serialized IDB transaction; timestamps may move backwards. */
export function latestDailyCompletions(state: LocalState): Map<string, DailyEvent> {
  const events = new Map<string, DailyEvent>()
  for (const event of state.dailyEvents) {
    if (['complete', 'undo', 'courseComplete', 'courseUndo'].includes(event.kind)) {
      events.set(dailyTargetKey(event), event)
    }
  }
  return events
}

export function resolveDailyEntries(state: LocalState, date: string): DailyResolvedEntry[] {
  const completions = latestDailyCompletions(state)
  return state.dayEntries
    .filter((entry) => entry.plannedDate === date)
    .map((entry): DailyResolvedEntry => {
      const todo =
        entry.kind === 'todo'
          ? state.todos.find((item) => item.publicId === entry.todoPublicId)
          : undefined
      const targetId = entry.kind === 'todo' ? entry.todoPublicId : entry.publicId
      const last = completions.get(`${entry.kind}:${targetId}`)
      const completed = entry.kind === 'dayTask' ? entry.completed : (todo?.completed ?? false)
      return {
        publicId: entry.publicId,
        kind: entry.kind,
        plannedDate: entry.plannedDate,
        initialDate: entry.initialDate,
        origin: entry.origin,
        title: entry.kind === 'dayTask' ? entry.title : (todo?.title ?? entry.titleSnapshot),
        completed,
        version: entry.kind === 'todo' && todo ? (todo.dailyVersion ?? 0) : entry.version,
        isPriority: entry.isPriority,
        position: entry.position,
        ddl: todo?.ddl ?? null,
        missingSource: entry.kind === 'todo' && !todo,
        completedDate:
          completed && last?.kind === 'complete' && isActiveDailySource(last)
            ? last.attributedDate
            : null,
        ...(entry.kind === 'todo' ? { todoPublicId: entry.todoPublicId } : {}),
        examLinked: todo?.examId != null,
      }
    })
    .sort(
      (a, b) =>
        Number(b.isPriority) - Number(a.isPriority) ||
        a.position - b.position ||
        a.publicId.localeCompare(b.publicId),
    )
}

export function dailyReviewFor(state: LocalState, date: string): DailyReview | undefined {
  return state.dailyReviews.find((review) => review.date === date)
}

/** Having a future plan is different from actively starting that future day. */
export function hasDailyActivity(state: LocalState, date: string): boolean {
  const review = dailyReviewFor(state, date)
  if (review?.saved || review?.draft) return true
  return state.dailyEvents.some(
    (event) =>
      isActiveDailySource(event) &&
      event.kind !== 'reviewPrompt' &&
      dailyBusinessDate(event.recordedAt) === date,
  )
}

/** Historical backfills are real material even though they were recorded on a later day. */
export function hasDailyReviewMaterial(state: LocalState, date: string): boolean {
  if (hasDailyActivity(state, date)) return true
  return state.dailyEvents.some(
    (event) =>
      isActiveDailySource(event) &&
      event.attributedDate === date &&
      ['complete', 'courseComplete'].includes(event.kind),
  )
}
