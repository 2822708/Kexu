import type {
  AiActionType,
  CoursePayload,
  ExamPayload,
  PeriodConfig,
  RecurringTodoPayload,
  Schedule,
} from '../types'
import { mutateLocalState, readLocalState } from './db'
import type { DailyOrigin } from './daily/types'
import {
  newPublicId,
  nextLocalId,
  type LocalCourse,
  type LocalExam,
  type LocalRecurringTodo,
  type LocalState,
  type LocalTodo,
} from './types'
import {
  assertLocal,
  normalizeDateTime,
  requireText,
  validDate,
  validateCourse,
  validateExam,
  validatePeriods,
  validateRecurring,
  validateSchedule,
} from './validation'

/** Stored wall-clock business dates consistently use Asia/Shanghai, independent of device timezone. */
export function nowLocalDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const part = (name: string) => parts.find((p) => p.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`
}
const wallDate = (value: string) => new Date(`${normalizeDateTime(value)}Z`)
const wallString = (date: Date) => date.toISOString().slice(0, 19)
const stamp = () => new Date().toISOString()
function find<T extends { id: number }>(rows: T[], id: number, label: string): T {
  const row = rows.find((r) => r.id === id)
  assertLocal(row, `${label}不存在或已删除`)
  return row
}
function metadata(state: LocalState) {
  return { id: nextLocalId(state), publicId: newPublicId(), createdAt: stamp(), updatedAt: stamp() }
}
const scheduleOf = (s: LocalState, id: number) => find(s.schedules, id, '课表')

function createSchedule(state: LocalState, body: Omit<Schedule, 'id'>) {
  const row = { ...metadata(state), ...validateSchedule(body) }
  state.schedules.push(row)
  return row
}
function updateSchedule(state: LocalState, id: number, body: Omit<Schedule, 'id'>) {
  const row = scheduleOf(state, id)
  Object.assign(row, validateSchedule(body), { updatedAt: stamp() })
  state.focusCompletions = state.focusCompletions.filter(
    (f) =>
      f.scheduleId !== id ||
      isCourseOccurrence(row, find(state.courses, f.courseId, '课程'), f.date),
  )
  return row
}
function removeSchedule(state: LocalState, id: number) {
  scheduleOf(state, id)
  const examIds = new Set(state.exams.filter((e) => e.scheduleId === id).map((e) => e.id))
  const removedTodoIds = new Set(
    state.todos.filter((t) => t.examId != null && examIds.has(t.examId)).map((t) => t.id),
  )
  state.schedules = state.schedules.filter((s) => s.id !== id)
  state.courses = state.courses.filter((c) => c.scheduleId !== id)
  state.exams = state.exams.filter((e) => e.scheduleId !== id)
  state.todos = state.todos.filter((t) => !removedTodoIds.has(t.id))
  state.focusCompletions = state.focusCompletions.filter((f) => f.scheduleId !== id)
  for (const c of state.conversations) if (c.scheduleId === id) c.scheduleId = null
  for (const m of state.messages)
    for (const a of m.actions ?? [])
      if (a.scheduleId === id && ['PENDING', 'EXECUTING'].includes(a.status)) a.status = 'STALE'
  return null
}
function createCourse(state: LocalState, scheduleId: number, body: CoursePayload): LocalCourse {
  scheduleOf(state, scheduleId)
  const row = { ...metadata(state), ...validateCourse(body), scheduleId }
  state.courses.push(row)
  return row
}
function updateCourse(state: LocalState, id: number, body: CoursePayload) {
  const row = find(state.courses, id, '课程')
  Object.assign(row, validateCourse(body), { updatedAt: stamp() })
  state.focusCompletions = state.focusCompletions.filter(
    (f) => f.courseId !== id || isCourseOccurrence(scheduleOf(state, row.scheduleId), row, f.date),
  )
  return row
}
function removeCourse(state: LocalState, id: number) {
  find(state.courses, id, '课程')
  state.courses = state.courses.filter((c) => c.id !== id)
  state.focusCompletions = state.focusCompletions.filter((f) => f.courseId !== id)
  return null
}
function createTodo(state: LocalState, body: { title: string; ddl: string }): LocalTodo {
  const title = requireText(body.title, '待办标题'),
    ddl = normalizeDateTime(body.ddl)
  const row = {
    ...metadata(state),
    title,
    ddl,
    completed: false,
    recurringId: null,
    examId: null,
    chainGenerated: false,
  }
  state.todos.push(row)
  return row
}
function updateTodo(state: LocalState, id: number, body: { title: string; ddl: string }) {
  const row = find(state.todos, id, '待办')
  assertLocal(row.examId == null, '考试关联待办请在考试管理中修改')
  Object.assign(row, {
    title: requireText(body.title, '待办标题'),
    ddl: normalizeDateTime(body.ddl),
    updatedAt: stamp(),
    dailyVersion: (row.dailyVersion ?? 0) + 1,
  })
  for (const entry of state.dayEntries)
    if (entry.kind === 'todo' && entry.todoPublicId === row.publicId)
      entry.titleSnapshot = row.title
  return row
}
function removeTodo(state: LocalState, id: number) {
  find(state.todos, id, '待办')
  state.todos = state.todos.filter((t) => t.id !== id)
  // Keep the occurrence tombstone so deletion or restore cannot recreate this same period.
  for (const occurrence of state.recurringOccurrences)
    if (occurrence.todoId === id) occurrence.todoId = null
  return null
}
export function setLocalTodoCompleted(
  state: LocalState,
  id: number,
  completed: boolean,
  context: {
    operationId?: string
    attributedDate?: string
    source?: 'manual' | 'backfill' | 'system'
    entryPublicId?: string | null
    origin?: DailyOrigin | null
  } = {},
) {
  const row = find(state.todos, id, '待办')
  assertLocal(typeof completed === 'boolean', '完成状态不合法')
  if (row.completed === completed) return row
  row.completed = completed
  row.dailyVersion = (row.dailyVersion ?? 0) + 1
  row.updatedAt = stamp()
  const attributedDate = context.attributedDate ?? nowLocalDateTime().slice(0, 10)
  const plannedEntry = state.dayEntries.find(
    (e) => e.kind === 'todo' && e.todoPublicId === row.publicId && e.plannedDate === attributedDate,
  )
  const prior = [...state.dailyEvents]
    .reverse()
    .find(
      (e) =>
        e.targetKind === 'todo' &&
        e.targetPublicId === row.publicId &&
        ['complete', 'undo'].includes(e.kind),
    )
  state.dailyEvents.push({
    publicId: newPublicId(),
    operationId: context.operationId ?? newPublicId(),
    kind: completed ? 'complete' : 'undo',
    targetKind: 'todo',
    targetPublicId: row.publicId,
    entryPublicId: context.entryPublicId ?? plannedEntry?.publicId ?? null,
    attributedDate,
    recordedAt: stamp(),
    occurredAt: context.source === 'backfill' ? null : stamp(),
    source: context.source ?? 'manual',
    titleSnapshot: row.title,
    origin: context.origin ?? plannedEntry?.origin ?? null,
    fromDate: null,
    toDate: null,
    previousEventId: prior?.publicId ?? null,
    targetVersion: row.dailyVersion,
    priorityAfter: plannedEntry?.isPriority ?? null,
  })
  if (row.completed && row.recurringId != null && !row.chainGenerated) {
    row.chainGenerated = true
    const rule = state.recurringRules.find((r) => r.id === row.recurringId)
    if (rule?.enabled && rule.chainAfterComplete && rule.frequency !== 'CUSTOM') {
      const occurrence = rule.nextTriggerAt ?? nextTriggerAfter(rule, nowLocalDateTime())
      if (occurrence) {
        spawnOccurrence(state, rule, occurrence)
        rule.lastTriggeredAt = occurrence
        rule.nextTriggerAt = nextTriggerAfter(rule, occurrence)
      }
    }
  }
  return row
}
function toggleTodo(state: LocalState, id: number) {
  const row = find(state.todos, id, '待办')
  return setLocalTodoCompleted(state, id, !row.completed)
}
function syncExamTodo(state: LocalState, exam: LocalExam, create = false) {
  let row = state.todos.find((t) => t.examId === exam.id)
  if (!row && create) {
    row = createTodo(state, { title: exam.name, ddl: `${exam.examDate}T${exam.startTime}` })
    row.examId = exam.id
  }
  if (row)
    Object.assign(row, {
      title: exam.name,
      ddl: `${exam.examDate}T${exam.startTime}`,
      updatedAt: stamp(),
    })
}
function createExam(state: LocalState, scheduleId: number, body: ExamPayload) {
  scheduleOf(state, scheduleId)
  const row = { ...metadata(state), ...validateExam(body), scheduleId }
  state.exams.push(row)
  syncExamTodo(state, row, true)
  return row
}
function updateExam(state: LocalState, id: number, body: ExamPayload) {
  const row = find(state.exams, id, '考试')
  Object.assign(row, validateExam(body), { updatedAt: stamp() })
  syncExamTodo(state, row)
  return row
}
function removeExam(state: LocalState, id: number) {
  find(state.exams, id, '考试')
  state.exams = state.exams.filter((e) => e.id !== id)
  state.todos = state.todos.filter((t) => t.examId !== id)
  return null
}
export function isCourseOccurrence(schedule: Schedule, course: LocalCourse, date: string): boolean {
  if (!validDate(date) || date < schedule.periodStartDate || date > schedule.periodEndDate)
    return false
  const selected = new Date(`${date}T00:00:00Z`),
    first = new Date(`${schedule.periodStartDate}T00:00:00Z`)
  const weekday = selected.getUTCDay() || 7
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() || 7) - 1))
  const week = Math.floor((selected.getTime() - first.getTime()) / 604800000) + 1
  return weekday === course.dayOfWeek && course.weeks.includes(week)
}
export function setFocusCompletion(
  state: LocalState,
  courseId: number,
  body: { scheduleId: number; date: string; completed: boolean },
  operationId = newPublicId(),
) {
  const schedule = scheduleOf(state, body.scheduleId),
    course = find(state.courses, courseId, '课程')
  assertLocal(
    course.scheduleId === schedule.id && isCourseOccurrence(schedule, course, body.date),
    '该日期没有安排这门课程',
  )
  assertLocal(typeof body.completed === 'boolean', '完成状态不合法')
  const current = state.focusCompletions.find(
    (f) => f.courseId === courseId && f.date === body.date,
  )
  if (!!current?.completed === body.completed) return null
  if (body.completed && !current)
    state.focusCompletions.push({
      publicId: newPublicId(),
      courseId,
      scheduleId: schedule.id,
      date: body.date,
      completed: true,
    })
  if (!body.completed && current)
    state.focusCompletions = state.focusCompletions.filter((f) => f !== current)
  const prior = [...state.dailyEvents]
    .reverse()
    .find(
      (e) =>
        e.targetKind === 'course' &&
        e.targetPublicId === course.publicId &&
        e.attributedDate === body.date &&
        ['courseComplete', 'courseUndo'].includes(e.kind),
    )
  state.dailyEvents.push({
    publicId: newPublicId(),
    operationId,
    kind: body.completed ? 'courseComplete' : 'courseUndo',
    targetKind: 'course',
    targetPublicId: course.publicId,
    entryPublicId: null,
    attributedDate: body.date,
    recordedAt: stamp(),
    occurredAt: stamp(),
    source: 'manual',
    titleSnapshot: course.name,
    origin: null,
    fromDate: null,
    toDate: null,
    previousEventId: prior?.publicId ?? null,
    targetVersion: (prior?.targetVersion ?? 0) + 1,
  })
  return null
}

export function nextTriggerAfter(
  rule: Pick<LocalRecurringTodo, 'frequency' | 'triggerTime' | 'dayOfWeek' | 'dayOfMonth'>,
  after: string,
): string | null {
  if (rule.frequency === 'CUSTOM') return null
  const base = wallDate(after),
    time = rule.triggerTime!
  let date = base.toISOString().slice(0, 10)
  const candidate = wallDate(`${date}T${time}`)
  if (rule.frequency === 'WEEKLY')
    candidate.setUTCDate(
      candidate.getUTCDate() + ((rule.dayOfWeek! - (base.getUTCDay() || 7) + 7) % 7),
    )
  if (rule.frequency === 'MONTHLY') {
    const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
    candidate.setUTCDate(Math.min(rule.dayOfMonth!, last))
  }
  if (candidate.getTime() <= base.getTime()) {
    if (rule.frequency === 'DAILY') candidate.setUTCDate(candidate.getUTCDate() + 1)
    else if (rule.frequency === 'WEEKLY') candidate.setUTCDate(candidate.getUTCDate() + 7)
    else {
      candidate.setUTCDate(1)
      candidate.setUTCMonth(candidate.getUTCMonth() + 1)
      const last = new Date(
        Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
      ).getUTCDate()
      candidate.setUTCDate(Math.min(rule.dayOfMonth!, last))
    }
  }
  date = wallString(candidate)
  return date
}
function spawnOccurrence(state: LocalState, rule: LocalRecurringTodo, at: string): boolean {
  at = normalizeDateTime(at)
  if (state.recurringOccurrences.some((o) => o.recurringId === rule.id && o.scheduledAt === at))
    return false
  const ddl = wallDate(at)
  ddl.setUTCMinutes(ddl.getUTCMinutes() + rule.ddlOffsetMinutes)
  const todo = createTodo(state, { title: rule.title, ddl: wallString(ddl) })
  todo.recurringId = rule.id
  state.recurringOccurrences.push({
    publicId: newPublicId(),
    recurringId: rule.id,
    scheduledAt: at,
    todoId: todo.id,
  })
  return true
}
function createRecurring(state: LocalState, body: RecurringTodoPayload) {
  const data = validateRecurring(body)
  const row = {
    id: nextLocalId(state),
    publicId: newPublicId(),
    ...data,
    lastTriggeredAt: null,
    nextTriggerAt: nextTriggerAfter(data, nowLocalDateTime()),
  }
  state.recurringRules.push(row)
  return row
}
function updateRecurring(state: LocalState, id: number, body: RecurringTodoPayload) {
  const row = find(state.recurringRules, id, '循环规则'),
    data = validateRecurring(body)
  Object.assign(row, data, { nextTriggerAt: nextTriggerAfter(data, nowLocalDateTime()) })
  return row
}
function removeRecurring(state: LocalState, id: number) {
  find(state.recurringRules, id, '循环规则')
  state.recurringRules = state.recurringRules.filter((r) => r.id !== id)
  for (const t of state.todos) if (t.recurringId === id) t.recurringId = null
  state.recurringOccurrences = state.recurringOccurrences.filter((o) => o.recurringId !== id)
  return null
}
function toggleRecurring(state: LocalState, id: number) {
  const row = find(state.recurringRules, id, '循环规则')
  row.enabled = !row.enabled
  if (row.enabled) row.nextTriggerAt = nextTriggerAfter(row, nowLocalDateTime())
  return row
}
function triggerRecurring(state: LocalState, id: number) {
  const row = find(state.recurringRules, id, '循环规则')
  assertLocal(row.frequency !== 'CUSTOM', '自定义脚本只保存在本地，本版本不执行脚本')
  // Minute-level key prevents repeated taps from duplicating one manual occurrence.
  const now = `${nowLocalDateTime().slice(0, 16)}:00`
  spawnOccurrence(state, row, now)
  row.lastTriggeredAt = now
  row.nextTriggerAt = nextTriggerAfter(row, now)
  return row
}

/** App-open/foreground sweep: bounded catch-up, transactional ledger, and exam completion. */
export function advanceLocalTime(state: LocalState, now = nowLocalDateTime()): number {
  now = normalizeDateTime(now)
  let generated = 0
  for (const rule of state.recurringRules) {
    if (!rule.enabled || rule.frequency === 'CUSTOM' || rule.nextTriggerAt == null) continue
    let rounds = 0
    while (rule.nextTriggerAt != null && rule.nextTriggerAt <= now && rounds < 5) {
      const at = rule.nextTriggerAt
      if (spawnOccurrence(state, rule, at)) generated++
      rule.lastTriggeredAt = at
      rule.nextTriggerAt = nextTriggerAfter(rule, at)
      rounds++
    }
    if (rule.nextTriggerAt != null && rule.nextTriggerAt <= now)
      rule.nextTriggerAt = nextTriggerAfter(rule, now)
  }
  const ended = new Set(
    state.exams.filter((e) => `${e.examDate}T${e.endTime}` <= now).map((e) => e.id),
  )
  for (const todo of state.todos)
    if (!todo.completed && todo.examId != null && ended.has(todo.examId)) {
      setLocalTodoCompleted(state, todo.id, true, {
        source: 'system',
        attributedDate: now.slice(0, 10),
      })
    }
  return generated
}
export const runLocalMaintenance = (now?: string) =>
  mutateLocalState((state) => advanceLocalTime(state, now))

export const localScheduleApi = {
  list: async () => (await readLocalState()).schedules,
  create: (body: Omit<Schedule, 'id'>) => mutateLocalState((s) => createSchedule(s, body)),
  update: (id: number, body: Omit<Schedule, 'id'>) =>
    mutateLocalState((s) => updateSchedule(s, id, body)),
  remove: (id: number) => mutateLocalState((s) => removeSchedule(s, id)),
}
export const localCourseApi = {
  listBySchedule: async (scheduleId: number) => {
    const s = await readLocalState()
    scheduleOf(s, scheduleId)
    return s.courses.filter((c) => c.scheduleId === scheduleId)
  },
  create: (scheduleId: number, body: CoursePayload) =>
    mutateLocalState((s) => createCourse(s, scheduleId, body)),
  batchCreate: (scheduleId: number, courses: CoursePayload[]) =>
    mutateLocalState((s) => {
      assertLocal(Array.isArray(courses) && courses.length <= 500, '批量课程不能超过 500 条')
      return courses.map((c) => createCourse(s, scheduleId, c))
    }),
  update: (id: number, body: CoursePayload) => mutateLocalState((s) => updateCourse(s, id, body)),
  remove: (id: number) => mutateLocalState((s) => removeCourse(s, id)),
}
export const localTodoApi = {
  list: async () => {
    await runLocalMaintenance()
    return (await readLocalState()).todos.sort((a, b) => a.ddl.localeCompare(b.ddl) || a.id - b.id)
  },
  create: (body: { title: string; ddl: string }) => mutateLocalState((s) => createTodo(s, body)),
  update: (id: number, body: { title: string; ddl: string }) =>
    mutateLocalState((s) => updateTodo(s, id, body)),
  remove: (id: number) => mutateLocalState((s) => removeTodo(s, id)),
  toggle: (id: number) => mutateLocalState((s) => toggleTodo(s, id)),
}
export const localExamApi = {
  listBySchedule: async (scheduleId: number) => {
    const s = await readLocalState()
    scheduleOf(s, scheduleId)
    return s.exams
      .filter((e) => e.scheduleId === scheduleId)
      .sort((a, b) => `${a.examDate}/${a.startTime}`.localeCompare(`${b.examDate}/${b.startTime}`))
  },
  create: (scheduleId: number, body: ExamPayload) =>
    mutateLocalState((s) => createExam(s, scheduleId, body)),
  update: (id: number, body: ExamPayload) => mutateLocalState((s) => updateExam(s, id, body)),
  remove: (id: number) => mutateLocalState((s) => removeExam(s, id)),
}
export const localPeriodApi = {
  list: async () => (await readLocalState()).periods,
  update: (configs: PeriodConfig[]) =>
    mutateLocalState((s) => {
      const cleaned = validatePeriods(configs)
      s.periods = cleaned.map((p) => ({
        ...p,
        publicId:
          s.periods.find((old) => old.periodNumber === p.periodNumber)?.publicId ?? newPublicId(),
      }))
      return s.periods
    }),
}
export const localFocusApi = {
  completedCourseIds: async (scheduleId: number, date: string) => {
    const s = await readLocalState()
    scheduleOf(s, scheduleId)
    assertLocal(validDate(date), '日期不合法')
    return s.focusCompletions
      .filter((f) => f.scheduleId === scheduleId && f.date === date && f.completed)
      .map((f) => f.courseId)
  },
  setCourseCompleted: (
    courseId: number,
    body: { scheduleId: number; date: string; completed: boolean },
  ) => mutateLocalState((s) => setFocusCompletion(s, courseId, body)),
}
export const localRecurringApi = {
  list: async () => {
    await runLocalMaintenance()
    return (await readLocalState()).recurringRules
  },
  create: (body: RecurringTodoPayload) => mutateLocalState((s) => createRecurring(s, body)),
  update: (id: number, body: RecurringTodoPayload) =>
    mutateLocalState((s) => updateRecurring(s, id, body)),
  remove: (id: number) => mutateLocalState((s) => removeRecurring(s, id)),
  toggle: (id: number) => mutateLocalState((s) => toggleRecurring(s, id)),
  triggerNow: (id: number) => mutateLocalState((s) => triggerRecurring(s, id)),
  scriptTemplate: async () => ({
    template:
      '// 自定义脚本仅保存，本地版本不执行。\nfunction shouldTrigger(ctx) { return false; }',
    maxLength: 4000,
    context: { executionEnabled: false },
  }),
  testScript: async (script: string) => ({
    valid: false,
    triggeredNow: false,
    error: script.length > 4000 ? '脚本过长' : '本地版本不执行自定义脚本；可保存脚本供后续版本使用',
  }),
}

/** Used by confirmed AI proposals, inside the same transaction as their EXECUTED status. */
export function applyLocalOperation(
  state: LocalState,
  type: AiActionType,
  data: Record<string, unknown>,
  scheduleId: number | null,
): void {
  const items = (key: string) => {
    const list = data[key]
    assertLocal(Array.isArray(list) && list.length > 0 && list.length <= 100, '操作列表不合法')
    return list
  }
  const scoped = (kind: 'courses' | 'exams', id: number) =>
    assertLocal(
      scheduleId != null &&
        find<{ id: number; scheduleId: number }>(state[kind], id, '记录').scheduleId === scheduleId,
      '操作不属于当前工作课表',
    )
  switch (type) {
    case 'CREATE_COURSE':
      assertLocal(scheduleId != null, '请先选择工作课表')
      for (const row of items('courses')) createCourse(state, scheduleId, row as CoursePayload)
      break
    case 'UPDATE_COURSE':
      for (const row of items('courses')) {
        scoped('courses', row.id)
        updateCourse(state, row.id, row)
      }
      break
    case 'DELETE_COURSE':
      for (const id of items('courseIds')) {
        scoped('courses', id)
        removeCourse(state, id)
      }
      break
    case 'CREATE_EXAM':
      assertLocal(scheduleId != null, '请先选择工作课表')
      for (const row of items('exams')) createExam(state, scheduleId, row as ExamPayload)
      break
    case 'UPDATE_EXAM':
      for (const row of items('exams')) {
        scoped('exams', row.id)
        updateExam(state, row.id, row)
      }
      break
    case 'DELETE_EXAM':
      for (const id of items('examIds')) {
        scoped('exams', id)
        removeExam(state, id)
      }
      break
    case 'CREATE_TODO':
      for (const row of items('todos')) createTodo(state, row)
      break
    case 'UPDATE_TODO':
      for (const row of items('todos')) updateTodo(state, row.id, row)
      break
    case 'DELETE_TODO':
      for (const id of items('todoIds')) removeTodo(state, id)
      break
    case 'TOGGLE_TODO':
      for (const id of items('todoIds')) toggleTodo(state, id)
      break
    case 'CREATE_RECURRING':
      for (const row of items('rules')) createRecurring(state, row)
      break
    case 'UPDATE_RECURRING':
      for (const row of items('rules')) updateRecurring(state, row.id, row)
      break
    case 'DELETE_RECURRING':
      for (const id of items('recurringIds')) removeRecurring(state, id)
      break
    case 'TOGGLE_RECURRING':
      for (const id of items('recurringIds')) toggleRecurring(state, id)
      break
    default:
      throw new Error('不支持的本地操作')
  }
}
