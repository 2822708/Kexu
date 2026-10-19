import type { LocalState } from '../types'
import {
  dailyReviewFor,
  dailyTargetKey,
  isActiveDailySource,
  latestDailyCompletions,
  resolveDailyEntries,
} from './selectors'

export const DAILY_REVIEW_ALGORITHM = 'daily-rules-v1'

export interface DailyReviewFacts {
  date: string
  algorithmVersion: string
  fingerprint: string
  summary: string
  counts: Record<string, number>
  completedTitles: string[]
}

/** A stable local comparison token, not a cryptographic hash or user identifier. */
function fingerprint(value: unknown): string {
  // Snapshot whitelists reconstruct object keys in a different order on restore.
  // Canonical keys keep an unchanged day from appearing to have new facts.
  const serialized = JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
  let hash = 2166136261
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${DAILY_REVIEW_ALGORITHM}:${(hash >>> 0).toString(16)}:${serialized.length}`
}

export function describeDailyFacts(counts: Record<string, number>): string {
  const sentences: string[] = []
  if (counts.completed > 0) {
    sentences.push(
      `你记录了${counts.completed}项已完成任务${counts.priorityCompleted ? `，其中${counts.priorityCompleted}项是重点` : ''}。`,
    )
    if (counts.adHocCompleted > 0) {
      sentences.push(
        `其中处理了${counts.adHocCompleted}件临时事项${counts.backfillCompleted ? `（${counts.backfillCompleted}件为补记）` : ''}。`,
      )
    }
  }
  if (counts.coursesConfirmed > 0)
    sentences.push(`另外确认参加了${counts.coursesConfirmed}次课程。`)
  if (counts.priorityAdjusted > 0)
    sentences.push(
      `曾选的${counts.priorityPlanned}项重点中，已调整${counts.priorityAdjusted}项；调整不算完成。`,
    )
  if (counts.remaining > 0)
    sentences.push(`还有${counts.remaining}项待做，可以拆小、改期，或先放下。`)
  if (counts.completed > 0 || counts.coursesConfirmed > 0) {
    sentences.push('每一件具体的推进，都值得被看见。')
  } else if (counts.remaining > 0) {
    sentences.push('计划已经记下，从一件小事开始就好。')
  } else {
    sentences.push('没有记录不代表没有付出，可以补记一件已做的小事，也可以只写下感受。')
  }
  return sentences.join('')
}

/** Counts only the latest currently valid manual completion of each target, never updatedAt. */
export function projectDailyReview(state: LocalState, date: string): DailyReviewFacts {
  const entries = resolveDailyEntries(state, date)
  const latest = latestDailyCompletions(state)
  const completedEvents = [...latest.values()].filter((event) => {
    if (event.kind !== 'complete' || event.attributedDate !== date || !isActiveDailySource(event))
      return false
    if (event.targetKind === 'todo') {
      const todo = state.todos.find((item) => item.publicId === event.targetPublicId)
      // Exam deadlines can be finished by the clock and are not action-task achievements.
      return todo ? todo.completed && todo.examId == null : true
    }
    if (event.targetKind === 'dayTask') {
      const task = state.dayEntries.find(
        (entry) => entry.kind === 'dayTask' && entry.publicId === event.targetPublicId,
      )
      return !task || (task.kind === 'dayTask' && task.completed)
    }
    return false
  })
  const completedKeys = new Set(completedEvents.map(dailyTargetKey))
  const priorityEntries = entries.filter(
    (entry) => entry.isPriority && !entry.missingSource && !entry.examLinked,
  )
  // Preserve every explicitly chosen priority, even when it is later deselected or moved.
  // entryPublicId survives conversion from an independent task to a referenced todo.
  const chosenPriorities = new Map<string, { target: string; entryId: string | null }>()
  for (const entry of priorityEntries) {
    chosenPriorities.set(entry.publicId, {
      target: `${entry.kind}:${entry.todoPublicId ?? entry.publicId}`,
      entryId: entry.publicId,
    })
  }
  for (const event of state.dailyEvents) {
    if (!isActiveDailySource(event)) continue
    if (event.attributedDate !== date && event.fromDate !== date) continue
    if (event.priorityBefore !== true && event.priorityAfter !== true) continue
    if (!['create', 'plan', 'priority', 'move', 'complete', 'undo', 'convert'].includes(event.kind))
      continue
    const key = event.entryPublicId ?? dailyTargetKey(event)
    chosenPriorities.set(key, { target: dailyTargetKey(event), entryId: event.entryPublicId })
  }
  const priorityCompleted = [...chosenPriorities.values()].filter(
    (chosen) =>
      completedKeys.has(chosen.target) ||
      completedEvents.some(
        (event) => chosen.entryId != null && event.entryPublicId === chosen.entryId,
      ),
  ).length
  const priorityAdjusted = [...chosenPriorities.values()].filter((chosen) => {
    const completed =
      completedKeys.has(chosen.target) ||
      completedEvents.some(
        (event) => chosen.entryId != null && event.entryPublicId === chosen.entryId,
      )
    const active = priorityEntries.some(
      (entry) =>
        entry.publicId === chosen.entryId ||
        `${entry.kind}:${entry.todoPublicId ?? entry.publicId}` === chosen.target,
    )
    return !completed && !active
  }).length
  const adHocCompleted = completedEvents.filter(
    (event) =>
      event.origin === 'adHoc' || event.origin === 'backfill' || event.source === 'backfill',
  ).length
  const courseEvents = [...latest.values()].filter(
    (event) =>
      event.kind === 'courseComplete' &&
      event.attributedDate === date &&
      isActiveDailySource(event),
  )
  const movedTargets = new Set(
    state.dailyEvents
      .filter(
        (event) => event.kind === 'move' && event.fromDate === date && isActiveDailySource(event),
      )
      .map(dailyTargetKey),
  )
  const counts: Record<string, number> = {
    completed: completedEvents.length,
    plannedCompleted: completedEvents.length - adHocCompleted,
    adHocCompleted,
    backfillCompleted: completedEvents.filter(
      (event) => event.source === 'backfill' || event.origin === 'backfill',
    ).length,
    priorityPlanned: chosenPriorities.size,
    priorityCompleted,
    priorityAdjusted,
    remaining: entries.filter(
      (entry) => !entry.completed && !entry.missingSource && !entry.examLinked,
    ).length,
    coursesConfirmed: courseEvents.length,
    movedOut: movedTargets.size,
  }
  const relatedEvents = state.dailyEvents.filter(
    (event) =>
      isActiveDailySource(event) &&
      !['reviewDraft', 'reviewSave', 'reviewDiscard', 'reviewPrompt', 'activity'].includes(
        event.kind,
      ) &&
      (event.attributedDate === date || event.fromDate === date || event.toDate === date),
  )
  const facts = {
    version: DAILY_REVIEW_ALGORITHM,
    date,
    counts,
    entries: entries
      .filter((entry) => !entry.examLinked)
      .map((entry) => [
        entry.publicId,
        entry.kind,
        entry.title,
        entry.completed,
        entry.isPriority,
        entry.missingSource,
        entry.completedDate,
      ]),
    events: relatedEvents,
  }
  return {
    date,
    algorithmVersion: DAILY_REVIEW_ALGORITHM,
    fingerprint: fingerprint(facts),
    summary: describeDailyFacts(counts),
    counts,
    completedTitles: completedEvents.map((event) => event.titleSnapshot),
  }
}

export function dailyReviewStatus(state: LocalState, date: string): string {
  const review = dailyReviewFor(state, date)
  if (review?.saved && review.saved.fingerprint !== projectDailyReview(state, date).fingerprint) {
    return review.draft ? '事实有更新 · 有未保存草稿' : '事实有更新，打开回顾后可刷新'
  }
  if (review?.draft) return '有未保存的回顾草稿'
  if (review?.saved) return '已保存回顾'
  return ''
}
