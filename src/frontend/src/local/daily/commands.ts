import { mutateLocalState, readLocalState } from '../db'
import { nowLocalDateTime, setFocusCompletion, setLocalTodoCompleted } from '../domain'
import { newPublicId, nextLocalId, type LocalState } from '../types'
import { assertLocal, normalizeDateTime, requireText, validDate } from '../validation'
import { resolveDailyEntries } from './selectors'
import { projectDailyReview } from './review'
import type {
  DailyCommandContext,
  DailyCommandResult,
  DailyEvent,
  DailyReview,
  DailyReviewContent,
  DayEntry,
} from './types'

type Context = DailyCommandContext
const stamp = () => new Date().toISOString()
const today = () => nowLocalDateTime().slice(0, 10)
function checkDate(date: string, ctx: Context, completion = false) {
  assertLocal(validDate(date), '日期不合法')
  assertLocal(date >= today() || ctx.allowPast, '编辑历史日期前请先进入更正模式')
  if (completion) assertLocal(date <= today(), '未来日期只可安排，不能提前完成')
}
function entryOf(state: LocalState, publicId: string) {
  const entry = state.dayEntries.find((e) => e.publicId === publicId)
  assertLocal(entry, '任务已移除，请刷新后重试')
  return entry
}
function todoOf(state: LocalState, entry: DayEntry) {
  if (entry.kind !== 'todo') return null
  const todo = state.todos.find((t) => t.publicId === entry.todoPublicId)
  assertLocal(todo, '关联待办已删除，历史记录仍然保留')
  return todo
}
function versionOf(state: LocalState, entry: DayEntry) {
  return entry.kind === 'todo' ? (todoOf(state, entry)!.dailyVersion ?? 0) : entry.version
}
function checkVersion(state: LocalState, entry: DayEntry, version: number) {
  assertLocal(
    Number.isSafeInteger(version) && version === versionOf(state, entry),
    '任务已在其他页面修改，请刷新后重试',
  )
}
function bump(state: LocalState, entry: DayEntry) {
  entry.version++
  entry.updatedAt = stamp()
  if (entry.kind === 'todo') {
    const todo = todoOf(state, entry)!
    todo.dailyVersion = (todo.dailyVersion ?? 0) + 1
  }
}
function event(
  state: LocalState,
  ctx: Context,
  entry: DayEntry | null,
  data: Partial<DailyEvent> & Pick<DailyEvent, 'kind' | 'attributedDate'>,
) {
  const todo = entry ? todoOf(state, entry) : null
  const row: DailyEvent = {
    publicId: newPublicId(),
    operationId: ctx.operationId,
    targetKind: entry?.kind ?? 'day',
    targetPublicId: todo?.publicId ?? entry?.publicId ?? state.datasetId,
    entryPublicId: entry?.publicId ?? null,
    recordedAt: stamp(),
    occurredAt: stamp(),
    source: 'manual',
    titleSnapshot: todo?.title ?? entry?.titleSnapshot ?? '',
    origin: entry?.origin ?? null,
    fromDate: null,
    toDate: null,
    previousEventId: null,
    targetVersion: entry ? versionOf(state, entry) : 0,
    priorityAfter: entry?.isPriority ?? null,
    ...data,
  }
  state.dailyEvents.push(row)
  return row
}
function command(
  ctx: Context,
  run: (state: LocalState) => Omit<DailyCommandResult, 'operationId'>,
): Promise<DailyCommandResult> {
  assertLocal(
    typeof ctx.operationId === 'string' && /^[0-9a-f-]{36}$/i.test(ctx.operationId),
    '操作编号不合法',
  )
  assertLocal(ctx.allowPast == null || typeof ctx.allowPast === 'boolean', '历史编辑状态不合法')
  return mutateLocalState((state) => {
    assertLocal(
      state.dataGeneration === ctx.expectedGeneration,
      '本地数据已恢复或替换，请刷新后重试',
    )
    const previous = state.dailyEvents.find((e) => e.operationId === ctx.operationId)
    if (previous)
      return {
        changed: false,
        operationId: ctx.operationId,
        entryPublicId: previous.entryPublicId ?? undefined,
        completionEventId: previous.kind === 'complete' ? previous.publicId : undefined,
      }
    const result = run(state)
    // A durable receipt also protects no-op retries after another tab changes the target.
    if (!state.dailyEvents.some((e) => e.operationId === ctx.operationId))
      event(state, ctx, null, { kind: 'activity', attributedDate: today(), source: 'system' })
    return { ...result, operationId: ctx.operationId }
  })
}
function reviewOf(state: LocalState, date: string): DailyReview {
  let row = state.dailyReviews.find((r) => r.date === date)
  if (!row) {
    row = {
      publicId: newPublicId(),
      date,
      version: 0,
      saved: null,
      draft: null,
      promptedYesterday: false,
    }
    state.dailyReviews.push(row)
  }
  return row
}
function checkedReview(state: LocalState, date: string, expectedVersion: number, ctx: Context) {
  checkDate(date, ctx)
  assertLocal(date <= today(), '未来日期还不能保存回顾')
  const row = reviewOf(state, date)
  assertLocal(row.version === expectedVersion, '回顾已在另一页面修改，请重新打开后保存')
  return row
}
function contentOf(content: DailyReviewContent): DailyReviewContent {
  assertLocal(content != null && typeof content === 'object', '回顾内容不合法')
  for (const [key, limit] of [
    ['feeling', 100],
    ['text', 2000],
    ['nextStep', 300],
  ] as const)
    assertLocal(typeof content[key] === 'string' && content[key].length <= limit, '回顾内容过长')
  return { feeling: content.feeling, text: content.text, nextStep: content.nextStep }
}

export const dailyApi = {
  async readWorkspace(date: string) {
    assertLocal(validDate(date), '日期不合法')
    const state = await readLocalState()
    const entries = resolveDailyEntries(state, date)
    return {
      state,
      date,
      generation: state.dataGeneration,
      entries,
      candidateTodos: state.todos.filter(
        (t) =>
          !t.completed &&
          t.examId == null &&
          !state.dayEntries.some(
            (e) => e.kind === 'todo' && e.todoPublicId === t.publicId && e.plannedDate === date,
          ),
      ),
      unfinishedEntries: [...new Set(state.dayEntries.map((e) => e.plannedDate))]
        .flatMap((d) => resolveDailyEntries(state, d))
        .filter((e) => !e.completed && !e.missingSource),
    }
  },
  createTask(
    body: Context & { date: string; title: string; completed?: boolean; isPriority?: boolean },
  ) {
    return command(body, (state) => {
      assertLocal(body.completed == null || typeof body.completed === 'boolean', '完成状态不合法')
      assertLocal(body.isPriority == null || typeof body.isPriority === 'boolean', '重点状态不合法')
      checkDate(body.date, body, !!body.completed)
      if (body.isPriority)
        assertLocal(
          state.dayEntries.filter((e) => e.plannedDate === body.date && e.isPriority).length < 3,
          '每天最多选择三项重点',
        )
      const title = requireText(body.title, '任务标题')
      const entry: DayEntry = {
        publicId: newPublicId(),
        plannedDate: body.date,
        initialDate: body.date,
        origin: body.completed ? 'backfill' : 'adHoc',
        position: Math.max(
          0,
          ...state.dayEntries.filter((e) => e.plannedDate === body.date).map((e) => e.position + 1),
        ),
        isPriority: !!body.isPriority,
        version: 0,
        createdAt: stamp(),
        updatedAt: stamp(),
        creationOperationId: body.operationId,
        titleSnapshot: title,
        kind: 'dayTask',
        title,
        completed: !!body.completed,
      }
      state.dayEntries.push(entry)
      const ev = event(state, body, entry, {
        kind: body.completed ? 'complete' : 'create',
        attributedDate: body.date,
        source: body.completed ? 'backfill' : 'manual',
        occurredAt: body.completed ? null : stamp(),
      })
      return {
        changed: true,
        entryPublicId: entry.publicId,
        completionEventId: body.completed ? ev.publicId : undefined,
      }
    })
  },
  planTodo(body: Context & { date: string; todoPublicId: string }) {
    return command(body, (state) => {
      checkDate(body.date, body)
      const todo = state.todos.find((t) => t.publicId === body.todoPublicId)
      assertLocal(todo && todo.examId == null, '待办不存在或属于考试日程')
      const existing = state.dayEntries.find(
        (e) =>
          e.kind === 'todo' && e.todoPublicId === body.todoPublicId && e.plannedDate === body.date,
      )
      if (existing) return { changed: false, entryPublicId: existing.publicId }
      assertLocal(!todo.completed, '已完成待办不再加入待做计划')
      const entry: DayEntry = {
        publicId: newPublicId(),
        kind: 'todo',
        todoPublicId: todo.publicId,
        plannedDate: body.date,
        initialDate: body.date,
        origin: 'planned',
        position: Math.max(
          0,
          ...state.dayEntries.filter((e) => e.plannedDate === body.date).map((e) => e.position + 1),
        ),
        isPriority: false,
        version: 0,
        createdAt: stamp(),
        updatedAt: stamp(),
        creationOperationId: body.operationId,
        titleSnapshot: todo.title,
      }
      state.dayEntries.push(entry)
      event(state, body, entry, { kind: 'plan', attributedDate: body.date })
      return { changed: true, entryPublicId: entry.publicId }
    })
  },
  setCompleted(
    body: Context & {
      entryPublicId: string
      completed: boolean
      expectedVersion: number
      undoOf?: string
    },
  ) {
    return command(body, (state) => {
      const entry = entryOf(state, body.entryPublicId)
      checkDate(entry.plannedDate, body, true)
      checkVersion(state, entry, body.expectedVersion)
      assertLocal(typeof body.completed === 'boolean', '完成状态不合法')
      const todo = todoOf(state, entry)
      assertLocal(todo?.examId == null, '考试安排不能作为普通任务完成')
      const latest = [...state.dailyEvents]
        .reverse()
        .find(
          (e) =>
            e.targetPublicId === (todo?.publicId ?? entry.publicId) &&
            ['complete', 'undo'].includes(e.kind),
        )
      if (body.undoOf)
        assertLocal(
          !body.completed &&
            latest?.publicId === body.undoOf &&
            latest.kind === 'complete' &&
            latest.targetVersion === body.expectedVersion,
          '该次完成已被后续操作改变，请从清单确认当前状态',
        )
      const current = todo ? todo.completed : entry.kind === 'dayTask' && entry.completed
      if (current === body.completed) return { changed: false, entryPublicId: entry.publicId }
      const isBackfill = entry.plannedDate < today() || entry.origin === 'backfill'
      if (todo) {
        setLocalTodoCompleted(state, todo.id, body.completed, {
          operationId: body.operationId,
          attributedDate: entry.plannedDate,
          source: isBackfill ? 'backfill' : 'manual',
          entryPublicId: entry.publicId,
          origin: entry.origin,
        })
      } else if (entry.kind === 'dayTask') {
        entry.completed = body.completed
        bump(state, entry)
        event(state, body, entry, {
          kind: body.completed ? 'complete' : 'undo',
          attributedDate: entry.plannedDate,
          previousEventId: latest?.publicId ?? null,
          source: isBackfill ? 'backfill' : 'manual',
          occurredAt: isBackfill ? null : stamp(),
        })
      }
      return {
        changed: true,
        entryPublicId: entry.publicId,
        completionEventId: body.completed
          ? state.dailyEvents[state.dailyEvents.length - 1].publicId
          : undefined,
      }
    })
  },
  setPriority(
    body: Context & { entryPublicId: string; isPriority: boolean; expectedVersion: number },
  ) {
    return command(body, (state) => {
      const entry = entryOf(state, body.entryPublicId)
      checkDate(entry.plannedDate, body)
      checkVersion(state, entry, body.expectedVersion)
      assertLocal(typeof body.isPriority === 'boolean', '重点状态不合法')
      if (entry.isPriority === body.isPriority)
        return { changed: false, entryPublicId: entry.publicId }
      if (body.isPriority)
        assertLocal(
          state.dayEntries.filter((e) => e.plannedDate === entry.plannedDate && e.isPriority)
            .length < 3,
          '每天最多选择三项重点',
        )
      const priorityBefore = entry.isPriority
      entry.isPriority = body.isPriority
      bump(state, entry)
      event(state, body, entry, {
        kind: 'priority',
        attributedDate: entry.plannedDate,
        priorityBefore,
      })
      return { changed: true, entryPublicId: entry.publicId }
    })
  },
  moveEntry(body: Context & { entryPublicId: string; date: string; expectedVersion: number }) {
    return command(body, (state) => {
      const entry = entryOf(state, body.entryPublicId)
      checkDate(entry.plannedDate, body)
      checkDate(body.date, body)
      checkVersion(state, entry, body.expectedVersion)
      if (entry.plannedDate === body.date) return { changed: false, entryPublicId: entry.publicId }
      const todo = todoOf(state, entry)
      assertLocal(
        !(todo?.completed ?? (entry.kind === 'dayTask' && entry.completed)),
        '已完成成果保留原归属日',
      )
      assertLocal(
        !todo ||
          !state.dayEntries.some(
            (e) =>
              e.kind === 'todo' && e.todoPublicId === todo.publicId && e.plannedDate === body.date,
          ),
        '目标日期已经选入这个待办',
      )
      const fromDate = entry.plannedDate,
        priorityBefore = entry.isPriority
      entry.plannedDate = body.date
      entry.isPriority = false
      bump(state, entry)
      event(state, body, entry, {
        kind: 'move',
        attributedDate: fromDate,
        fromDate,
        toDate: body.date,
        priorityBefore,
      })
      return { changed: true, entryPublicId: entry.publicId }
    })
  },
  convertToTodo(body: Context & { entryPublicId: string; ddl: string; expectedVersion: number }) {
    return command(body, (state) => {
      const entry = entryOf(state, body.entryPublicId)
      checkDate(entry.plannedDate, body)
      checkVersion(state, entry, body.expectedVersion)
      assertLocal(entry.kind === 'dayTask' && !entry.completed, '仅待做临时事项可以转为长期待办')
      const todo = {
        id: nextLocalId(state),
        publicId: newPublicId(),
        title: entry.title,
        ddl: normalizeDateTime(body.ddl),
        completed: false,
        recurringId: null,
        examId: null,
        dailyVersion: entry.version + 1,
        createdAt: stamp(),
        updatedAt: stamp(),
      }
      state.todos.push(todo)
      const next: DayEntry = {
        ...entry,
        kind: 'todo',
        todoPublicId: todo.publicId,
        version: entry.version + 1,
        updatedAt: stamp(),
      }
      delete (next as unknown as Record<string, unknown>).title
      delete (next as unknown as Record<string, unknown>).completed
      state.dayEntries[state.dayEntries.indexOf(entry)] = next
      event(state, body, next, { kind: 'convert', attributedDate: next.plannedDate })
      return { changed: true, entryPublicId: next.publicId }
    })
  },
  confirmCourseAttendance(
    body: Context & { courseId: number; scheduleId: number; date: string; completed: boolean },
  ) {
    return command(body, (state) => {
      checkDate(body.date, body, true)
      const before = state.dailyEvents.length
      setFocusCompletion(state, body.courseId, body, body.operationId)
      return { changed: state.dailyEvents.length !== before }
    })
  },
  markActivity(body: Context & { date: string }) {
    return command(body, (state) => {
      checkDate(body.date, body, true)
      event(state, body, null, { kind: 'activity', attributedDate: body.date })
      return { changed: true }
    })
  },
  saveReviewDraft(
    body: Context & { date: string; expectedVersion: number; content: DailyReviewContent },
  ) {
    return command(body, (state) => {
      const row = checkedReview(state, body.date, body.expectedVersion, body)
      row.draft = { ...contentOf(body.content), updatedAt: stamp() }
      row.version++
      event(state, body, null, {
        kind: 'reviewDraft',
        attributedDate: body.date,
        targetKind: 'review',
        targetPublicId: row.publicId,
        targetVersion: row.version,
      })
      return { changed: true }
    })
  },
  saveReview(
    body: Context & {
      date: string
      expectedVersion: number
      content: DailyReviewContent
      facts: {
        fingerprint: string
        summary: string
        counts: Record<string, number>
        algorithmVersion: string
      }
    },
  ) {
    return command(body, (state) => {
      const row = checkedReview(state, body.date, body.expectedVersion, body)
      const currentFacts = projectDailyReview(state, body.date)
      assertLocal(
        currentFacts.fingerprint === body.facts.fingerprint,
        '今日事实已更新，请刷新小结后再保存',
      )
      row.saved = {
        ...contentOf(body.content),
        savedAt: stamp(),
        fingerprint: currentFacts.fingerprint,
        summary: currentFacts.summary,
        facts: { ...currentFacts.counts },
        algorithmVersion: currentFacts.algorithmVersion,
      }
      row.draft = null
      row.version++
      event(state, body, null, {
        kind: 'reviewSave',
        attributedDate: body.date,
        targetKind: 'review',
        targetPublicId: row.publicId,
        targetVersion: row.version,
      })
      return { changed: true }
    })
  },
  refreshReviewFacts(
    body: Context & {
      date: string
      expectedVersion: number
      facts: {
        fingerprint: string
        summary: string
        counts: Record<string, number>
        algorithmVersion: string
      }
    },
  ) {
    return command(body, (state) => {
      const row = checkedReview(state, body.date, body.expectedVersion, body)
      assertLocal(row.saved, '请先保存一份回顾')
      const currentFacts = projectDailyReview(state, body.date)
      assertLocal(
        currentFacts.fingerprint === body.facts.fingerprint,
        '今日事实已更新，请重新刷新小结',
      )
      Object.assign(row.saved, {
        fingerprint: currentFacts.fingerprint,
        summary: currentFacts.summary,
        facts: { ...currentFacts.counts },
        algorithmVersion: currentFacts.algorithmVersion,
      })
      row.version++
      event(state, body, null, {
        kind: 'reviewSave',
        attributedDate: body.date,
        targetKind: 'review',
        targetPublicId: row.publicId,
        targetVersion: row.version,
      })
      return { changed: true }
    })
  },
  discardReviewDraft(body: Context & { date: string; expectedVersion: number }) {
    return command(body, (state) => {
      const row = checkedReview(state, body.date, body.expectedVersion, body)
      if (!row.draft) return { changed: false }
      row.draft = null
      row.version++
      event(state, body, null, {
        kind: 'reviewDiscard',
        attributedDate: body.date,
        targetKind: 'review',
        targetPublicId: row.publicId,
        targetVersion: row.version,
      })
      return { changed: true }
    })
  },
  markReviewPrompt(body: Context & { date: string }) {
    return command(body, (state) => {
      assertLocal(body.date === today(), '询问标记只属于今日')
      const row = reviewOf(state, body.date)
      if (row.promptedYesterday) return { changed: false }
      row.promptedYesterday = true
      row.version++
      event(state, body, null, {
        kind: 'reviewPrompt',
        attributedDate: body.date,
        targetKind: 'review',
        targetPublicId: row.publicId,
        targetVersion: row.version,
      })
      return { changed: true }
    })
  },
}
