import type {
  CoursePayload,
  ExamPayload,
  PeriodConfig,
  RecurringTodoPayload,
  Schedule,
} from '../types'
import { newPublicId, type LocalState } from './types'

export function assertLocal(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
export function requireText(value: unknown, field: string, max = 500): string {
  assertLocal(
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    `${field}不能为空且长度不能超过 ${max}`,
  )
  return value.trim()
}
export function integer(value: unknown, min: number, max: number, field: string): number {
  assertLocal(
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    `${field}范围应为 ${min}–${max}`,
  )
  return value
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
}
export function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
}
export function normalizeTime(value: unknown): string {
  assertLocal(validTime(value), '时间格式应为 HH:mm 或 HH:mm:ss')
  return value.length === 5 ? `${value}:00` : value
}
export function normalizeDateTime(value: unknown): string {
  assertLocal(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value),
    '日期时间格式不正确',
  )
  assertLocal(validDate(value.slice(0, 10)), '日期不合法')
  return `${value.slice(0, 10)}T${normalizeTime(value.slice(11))}`
}
export function validateSchedule(body: Omit<Schedule, 'id'>) {
  const name = requireText(body.name, '课表名称', 100)
  assertLocal(validDate(body.periodStartDate) && validDate(body.periodEndDate), '学期日期不合法')
  assertLocal(body.periodStartDate <= body.periodEndDate, '学期结束日期不能早于开始日期')
  return { name, periodStartDate: body.periodStartDate, periodEndDate: body.periodEndDate }
}
export function validateCourse(body: CoursePayload) {
  const name = requireText(body.name, '课程名称', 100)
  integer(body.dayOfWeek, 1, 7, '星期')
  integer(body.startPeriod, 1, 24, '开始节次')
  integer(body.endPeriod, body.startPeriod, 24, '结束节次')
  assertLocal(
    Array.isArray(body.weeks) && body.weeks.length > 0 && body.weeks.length <= 60,
    '课程必须包含 1–60 周中的有效周次',
  )
  body.weeks.forEach((week) => integer(week, 1, 60, '周次'))
  const nullable = (value: unknown, field: string) =>
    value == null || value === '' ? null : requireText(value, field, 200)
  return {
    name,
    location: nullable(body.location, '上课地点'),
    teacher: nullable(body.teacher, '教师'),
    dayOfWeek: body.dayOfWeek,
    startPeriod: body.startPeriod,
    endPeriod: body.endPeriod,
    weeks: [...new Set(body.weeks)].sort((a, b) => a - b),
  }
}
export function validateExam(body: ExamPayload) {
  const name = requireText(body.name, '考试名称', 100)
  assertLocal(validDate(body.examDate), '考试日期不合法')
  const startTime = normalizeTime(body.startTime),
    endTime = normalizeTime(body.endTime)
  assertLocal(endTime > startTime, '考试结束时间必须晚于开始时间')
  return {
    name,
    location:
      body.location == null || body.location === ''
        ? null
        : requireText(body.location, '考试地点', 200),
    examDate: body.examDate,
    startTime,
    endTime,
  }
}
export function validateRecurring(body: RecurringTodoPayload): RecurringTodoPayload {
  const title = requireText(body.title, '循环标题')
  assertLocal(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'].includes(body.frequency), '不支持的循环频率')
  integer(body.ddlOffsetMinutes, 1, 5256000, '截止偏移分钟')
  assertLocal(
    typeof body.enabled === 'boolean' && typeof body.chainAfterComplete === 'boolean',
    '循环开关不合法',
  )
  if (body.frequency === 'WEEKLY') integer(body.dayOfWeek, 1, 7, '每周日期')
  if (body.frequency === 'MONTHLY') integer(body.dayOfMonth, 1, 31, '每月日期')
  return {
    title,
    frequency: body.frequency,
    dayOfWeek: body.frequency === 'WEEKLY' ? body.dayOfWeek : null,
    dayOfMonth: body.frequency === 'MONTHLY' ? body.dayOfMonth : null,
    triggerTime: body.frequency === 'CUSTOM' ? null : normalizeTime(body.triggerTime),
    script: body.frequency === 'CUSTOM' ? requireText(body.script, '自定义脚本', 4000) : null,
    ddlOffsetMinutes: body.ddlOffsetMinutes,
    enabled: body.enabled,
    chainAfterComplete: body.chainAfterComplete,
  }
}
export function validatePeriods(periods: PeriodConfig[]): PeriodConfig[] {
  assertLocal(
    Array.isArray(periods) && periods.length > 0 && periods.length <= 24,
    '节次配置应包含 1–24 条',
  )
  const numbers = new Set<number>()
  let previousEnd = ''
  return [...periods]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((p) => {
      integer(p.periodNumber, 1, 24, '节次')
      assertLocal(!numbers.has(p.periodNumber), '节次编号重复')
      numbers.add(p.periodNumber)
      const startTime = normalizeTime(p.startTime),
        endTime = normalizeTime(p.endTime)
      assertLocal(
        endTime > startTime && startTime >= previousEnd,
        '节次结束时间必须晚于开始时间且各节次不能重叠',
      )
      assertLocal(['MORNING', 'AFTERNOON', 'EVENING'].includes(p.category), '节次分类不合法')
      previousEnd = endTime
      return { periodNumber: p.periodNumber, startTime, endTime, category: p.category }
    })
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function validateLocalState(value: unknown): asserts value is LocalState {
  assertLocal(value !== null && typeof value === 'object', '本地数据格式不正确')
  const s = value as LocalState
  assertLocal(s.schemaVersion === 2, '本地数据需要新版应用，请更新后重试')
  assertLocal(typeof s.dataGeneration === 'string' && uuid.test(s.dataGeneration), '恢复代次不合法')
  assertLocal(typeof s.datasetId === 'string' && uuid.test(s.datasetId), '数据集标识不合法')
  integer(s.revision, 0, Number.MAX_SAFE_INTEGER - 1, '数据版本')
  integer(s.nextId, 1, Number.MAX_SAFE_INTEGER - 1, '本地编号')
  assertLocal(
    typeof s.createdAt === 'string' &&
      Number.isFinite(Date.parse(s.createdAt)) &&
      typeof s.updatedAt === 'string' &&
      Number.isFinite(Date.parse(s.updatedAt)),
    '数据时间戳不合法',
  )
  const names = [
    'schedules',
    'courses',
    'exams',
    'todos',
    'periods',
    'focusCompletions',
    'recurringRules',
    'recurringOccurrences',
    'conversations',
    'messages',
    'dayEntries',
    'dailyEvents',
    'dailyReviews',
  ] as const
  const publicIds = new Set<string>()
  for (const name of names) {
    assertLocal(
      Array.isArray(s[name]) && s[name].length <= 100000,
      `${name} 集合不合法或超过容量限制`,
    )
    for (const row of s[name]) {
      assertLocal(
        row != null &&
          typeof row === 'object' &&
          typeof row.publicId === 'string' &&
          uuid.test(row.publicId) &&
          !publicIds.has(row.publicId),
        `${name} 存在非法或重复标识`,
      )
      publicIds.add(row.publicId)
    }
  }
  let maxId = 0
  for (const name of [
    'schedules',
    'courses',
    'exams',
    'todos',
    'recurringRules',
    'conversations',
  ] as const) {
    const ids = new Set<number>()
    for (const row of s[name]) {
      integer(row.id, 1, Number.MAX_SAFE_INTEGER - 1, '记录编号')
      assertLocal(!ids.has(row.id), `${name} 编号重复`)
      ids.add(row.id)
      maxId = Math.max(maxId, row.id)
    }
  }
  const scheduleIds = new Set(s.schedules.map((x) => x.id)),
    courseIds = new Set(s.courses.map((x) => x.id)),
    examIds = new Set(s.exams.map((x) => x.id)),
    recurringIds = new Set(s.recurringRules.map((x) => x.id)),
    todoIds = new Set(s.todos.map((x) => x.id)),
    conversationIds = new Set(s.conversations.map((x) => x.id))
  s.schedules.forEach(validateSchedule)
  s.courses.forEach((c) => {
    validateCourse(c)
    assertLocal(scheduleIds.has(c.scheduleId), '课程关联的课表不存在')
  })
  s.exams.forEach((e) => {
    validateExam(e)
    assertLocal(scheduleIds.has(e.scheduleId), '考试关联的课表不存在')
  })
  s.todos.forEach((t) => {
    requireText(t.title, '待办标题')
    normalizeDateTime(t.ddl)
    assertLocal(typeof t.completed === 'boolean', '待办完成状态不合法')
    if (t.dailyVersion != null)
      integer(t.dailyVersion, 0, Number.MAX_SAFE_INTEGER - 1, '待办状态版本')
    assertLocal(t.recurringId == null || recurringIds.has(t.recurringId), '待办关联的循环不存在')
    assertLocal(t.examId == null || examIds.has(t.examId), '待办关联的考试不存在')
    assertLocal(!(t.recurringId != null && t.examId != null), '待办不能同时关联循环和考试')
    assertLocal(
      t.chainGenerated == null || typeof t.chainGenerated === 'boolean',
      '循环接续标记不合法',
    )
  })
  validatePeriods(s.periods)
  s.recurringRules.forEach((r) => {
    validateRecurring(r)
    if (r.nextTriggerAt != null) normalizeDateTime(r.nextTriggerAt)
    if (r.lastTriggeredAt != null) normalizeDateTime(r.lastTriggeredAt)
  })
  const focusKeys = new Set<string>(),
    occurrenceKeys = new Set<string>(),
    linkedExams = new Set<number>()
  s.todos.forEach((t) => {
    if (t.examId != null) {
      assertLocal(!linkedExams.has(t.examId), '考试待办关联重复')
      linkedExams.add(t.examId)
    }
  })
  s.focusCompletions.forEach((f) => {
    assertLocal(
      scheduleIds.has(f.scheduleId) &&
        courseIds.has(f.courseId) &&
        s.courses.find((c) => c.id === f.courseId)?.scheduleId === f.scheduleId &&
        validDate(f.date) &&
        typeof f.completed === 'boolean',
      '专注记录关联不合法',
    )
    const key = `${f.courseId}/${f.date}`
    assertLocal(!focusKeys.has(key), '专注记录重复')
    focusKeys.add(key)
  })
  s.recurringOccurrences.forEach((o) => {
    assertLocal(
      recurringIds.has(o.recurringId) && (o.todoId == null || todoIds.has(o.todoId)),
      '循环发生记录关联不合法',
    )
    normalizeDateTime(o.scheduledAt)
    const key = `${o.recurringId}/${o.scheduledAt}`
    assertLocal(!occurrenceKeys.has(key), '循环发生记录重复')
    occurrenceKeys.add(key)
  })
  s.conversations.forEach((c) => {
    assertLocal(c.scheduleId == null || scheduleIds.has(c.scheduleId), '会话关联课表不存在')
    requireText(c.title, '会话标题', 200)
  })
  const messageIds = new Set<number>(),
    actionIds = new Set<number>()
  const actionTypes = [
    'CREATE_COURSE',
    'UPDATE_COURSE',
    'DELETE_COURSE',
    'CREATE_TODO',
    'UPDATE_TODO',
    'DELETE_TODO',
    'TOGGLE_TODO',
    'CREATE_RECURRING',
    'UPDATE_RECURRING',
    'DELETE_RECURRING',
    'TOGGLE_RECURRING',
    'CREATE_EXAM',
    'UPDATE_EXAM',
    'DELETE_EXAM',
  ]
  s.messages.forEach((m) => {
    integer(m.messageId, 1, Number.MAX_SAFE_INTEGER - 1, '消息编号')
    assertLocal(!messageIds.has(m.messageId), '消息编号重复')
    messageIds.add(m.messageId)
    maxId = Math.max(maxId, m.messageId)
    assertLocal(
      conversationIds.has(m.conversationId) &&
        ['user', 'assistant'].includes(m.role) &&
        typeof m.text === 'string' &&
        m.text.length <= 200000,
      '会话消息不合法',
    )
    assertLocal(
      m.actions == null || (Array.isArray(m.actions) && m.actions.length <= 1000),
      'AI提案集合不合法',
    )
    for (const a of m.actions ?? []) {
      assertLocal(a != null && typeof a === 'object', 'AI提案格式不合法')
      integer(a.actionId, 1, Number.MAX_SAFE_INTEGER - 1, 'AI提案编号')
      assertLocal(!actionIds.has(a.actionId), 'AI提案编号重复')
      actionIds.add(a.actionId)
      maxId = Math.max(maxId, a.actionId)
      assertLocal(
        actionTypes.includes(a.type) &&
          ['PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED', 'STALE'].includes(a.status) &&
          ['COURSE', 'TODO'].includes(a.scope),
        'AI提案类型或状态不合法',
      )
      assertLocal(
        a.scheduleId == null ||
          (typeof a.scheduleId === 'number' &&
            Number.isSafeInteger(a.scheduleId) &&
            a.scheduleId > 0),
        'AI提案课表编号不合法',
      )
      assertLocal(
        a.data == null || (typeof a.data === 'object' && !Array.isArray(a.data)),
        'AI提案数据不合法',
      )
    }
  })
  assertLocal(s.nextId > maxId, '本地编号必须大于现存记录编号')
  const textOrEmpty = (v: unknown, max: number, label: string) =>
    assertLocal(typeof v === 'string' && v.length <= max, `${label}不合法`)
  const timestamp = (v: unknown) =>
    assertLocal(typeof v === 'string' && Number.isFinite(Date.parse(v)), '日任务时间不合法')
  const validUuid = (v: unknown) => typeof v === 'string' && uuid.test(v)
  const entryKeys = new Set<string>(),
    reviewDates = new Set<string>(),
    operations = new Set<string>()
  for (const e of s.dayEntries) {
    assertLocal(validDate(e.plannedDate) && validDate(e.initialDate), '日任务日期不合法')
    assertLocal(['planned', 'adHoc', 'backfill'].includes(e.origin), '日任务来源不合法')
    assertLocal(
      typeof e.isPriority === 'boolean' && validUuid(e.creationOperationId),
      '日任务状态不合法',
    )
    integer(e.position, 0, Number.MAX_SAFE_INTEGER - 1, '任务顺序')
    integer(e.version, 0, Number.MAX_SAFE_INTEGER - 1, '任务版本')
    timestamp(e.createdAt)
    timestamp(e.updatedAt)
    requireText(e.titleSnapshot, '任务标题快照')
    if (e.kind === 'dayTask') {
      requireText(e.title, '日任务标题')
      assertLocal(typeof e.completed === 'boolean', '日任务完成状态不合法')
    } else {
      assertLocal(
        e.kind === 'todo' && validUuid(e.todoPublicId) && !('completed' in e),
        '日任务待办引用不合法',
      )
      const key = `${e.plannedDate}/${e.todoPublicId}`
      assertLocal(!entryKeys.has(key), '同日待办重复选入')
      entryKeys.add(key)
    }
  }
  const priorities = new Map<string, number>()
  for (const e of s.dayEntries)
    if (e.isPriority) priorities.set(e.plannedDate, (priorities.get(e.plannedDate) ?? 0) + 1)
  assertLocal(
    [...priorities.values()].every((count) => count <= 3),
    '每日重点不能超过三项',
  )
  const priorEvents = new Map<string, (typeof s.dailyEvents)[number]>()
  for (const e of s.dailyEvents) {
    assertLocal(validUuid(e.operationId) && !operations.has(e.operationId), '日操作编号非法或重复')
    operations.add(e.operationId)
    assertLocal(
      [
        'create',
        'plan',
        'complete',
        'undo',
        'priority',
        'move',
        'convert',
        'activity',
        'courseComplete',
        'courseUndo',
        'reviewDraft',
        'reviewSave',
        'reviewDiscard',
        'reviewPrompt',
      ].includes(e.kind),
      '日事件类型不合法',
    )
    assertLocal(
      ['dayTask', 'todo', 'course', 'review', 'day'].includes(e.targetKind) &&
        validUuid(e.targetPublicId),
      '日事件目标不合法',
    )
    if (['complete', 'undo', 'priority', 'move'].includes(e.kind))
      assertLocal(['dayTask', 'todo'].includes(e.targetKind), '任务事件目标类型不合法')
    if (['courseComplete', 'courseUndo'].includes(e.kind))
      assertLocal(e.targetKind === 'course', '课程事件目标类型不合法')
    if (['reviewDraft', 'reviewSave', 'reviewDiscard', 'reviewPrompt'].includes(e.kind))
      assertLocal(e.targetKind === 'review', '回顾事件目标类型不合法')
    if (e.kind === 'create') assertLocal(e.targetKind === 'dayTask', '新增日任务事件目标不合法')
    if (['plan', 'convert'].includes(e.kind))
      assertLocal(e.targetKind === 'todo', '关联待办事件目标不合法')
    assertLocal(e.entryPublicId === null || validUuid(e.entryPublicId), '日事件清单引用不合法')
    assertLocal(
      validDate(e.attributedDate) &&
        (e.fromDate === null || validDate(e.fromDate)) &&
        (e.toDate === null || validDate(e.toDate)),
      '日事件日期不合法',
    )
    assertLocal(
      ['manual', 'backfill', 'system', 'legacyUnknown'].includes(e.source),
      '日事件来源不合法',
    )
    assertLocal(
      e.origin === null || ['planned', 'adHoc', 'backfill'].includes(e.origin),
      '日事件任务来源不合法',
    )
    timestamp(e.recordedAt)
    if (e.occurredAt !== null) timestamp(e.occurredAt)
    textOrEmpty(e.titleSnapshot, 500, '日事件标题')
    integer(e.targetVersion, 0, Number.MAX_SAFE_INTEGER - 1, '日事件版本')
    for (const value of [e.priorityBefore, e.priorityAfter])
      assertLocal(value == null || typeof value === 'boolean', '日事件重点快照不合法')
    const previous = e.previousEventId === null ? null : priorEvents.get(e.previousEventId)
    assertLocal(
      e.previousEventId === null ||
        (previous &&
          previous.targetKind === e.targetKind &&
          previous.targetPublicId === e.targetPublicId &&
          previous.targetVersion < e.targetVersion &&
          (e.targetKind !== 'course' || previous.attributedDate === e.attributedDate)),
      '日事件原操作不存在或不属于同一事项',
    )
    priorEvents.set(e.publicId, e)
  }
  for (const r of s.dailyReviews) {
    assertLocal(validDate(r.date) && !reviewDates.has(r.date), '每日回顾日期非法或重复')
    reviewDates.add(r.date)
    integer(r.version, 0, Number.MAX_SAFE_INTEGER - 1, '回顾版本')
    assertLocal(typeof r.promptedYesterday === 'boolean', '回顾询问状态不合法')
    for (const content of [r.saved, r.draft])
      if (content !== null) {
        assertLocal(content != null && typeof content === 'object', '回顾内容不合法')
        textOrEmpty(content.feeling, 100, '回顾感受')
        textOrEmpty(content.text, 4000, '回顾文字')
        textOrEmpty(content.nextStep, 500, '明日第一步')
      }
    if (r.saved) {
      timestamp(r.saved.savedAt)
      requireText(r.saved.fingerprint, '回顾指纹', 500)
      requireText(r.saved.algorithmVersion, '回顾算法', 100)
      textOrEmpty(r.saved.summary, 4000, '回顾小结')
      assertLocal(
        r.saved.facts != null &&
          typeof r.saved.facts === 'object' &&
          !Array.isArray(r.saved.facts) &&
          Object.keys(r.saved.facts).length <= 50,
        '回顾事实不合法',
      )
      for (const n of Object.values(r.saved.facts))
        integer(n, 0, Number.MAX_SAFE_INTEGER - 1, '回顾计数')
    }
    if (r.draft) timestamp(r.draft.updatedAt)
  }
}

/** The original validator is preserved by validating every v1 collection before augmentation. */
export function validateLocalStateV1(value: unknown): void {
  assertLocal(
    value != null &&
      typeof value === 'object' &&
      (value as { schemaVersion?: unknown }).schemaVersion === 1,
    '不支持的旧本地数据版本',
  )
  const incoming = value as Record<string, unknown>
  assertLocal(
    !('dayEntries' in incoming) && !('dailyEvents' in incoming) && !('dailyReviews' in incoming),
    '旧格式含无法识别的日数据',
  )
  validateLocalState({
    ...incoming,
    schemaVersion: 2,
    dataGeneration: newPublicId(),
    dayEntries: [],
    dailyEvents: [],
    dailyReviews: [],
  })
}
export function migrateLocalStateV1(value: unknown): LocalState {
  validateLocalStateV1(value)
  return {
    ...(structuredClone(value) as Omit<
      LocalState,
      'schemaVersion' | 'dataGeneration' | 'dayEntries' | 'dailyEvents' | 'dailyReviews'
    >),
    schemaVersion: 2,
    dataGeneration: newPublicId(),
    dayEntries: [],
    dailyEvents: [],
    dailyReviews: [],
  }
}
