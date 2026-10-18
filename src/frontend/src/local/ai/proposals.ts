import type { AiAction, AiActionType } from '../../types'
import type { LocalState } from '../types'

type Dict = Record<string, unknown>
export interface DraftProposal {
  type: AiActionType
  data: Dict
}
export interface ValidatedReply {
  reply: string
  proposals: DraftProposal[]
}
interface Guard {
  version: 1
  datasetId: string
  scheduleBasis: string | null
  targetBasis: string | null
  payloadBasis: string
  expiresAt: number
}

const KINDS: Record<
  AiActionType,
  { key: string; collection: 'courses' | 'todos' | 'exams' | 'recurringRules'; scoped: boolean }
> = {
  CREATE_COURSE: { key: 'courses', collection: 'courses', scoped: true },
  UPDATE_COURSE: { key: 'courses', collection: 'courses', scoped: true },
  DELETE_COURSE: { key: 'courseIds', collection: 'courses', scoped: true },
  CREATE_TODO: { key: 'todos', collection: 'todos', scoped: false },
  UPDATE_TODO: { key: 'todos', collection: 'todos', scoped: false },
  DELETE_TODO: { key: 'todoIds', collection: 'todos', scoped: false },
  TOGGLE_TODO: { key: 'todoIds', collection: 'todos', scoped: false },
  CREATE_EXAM: { key: 'exams', collection: 'exams', scoped: true },
  UPDATE_EXAM: { key: 'exams', collection: 'exams', scoped: true },
  DELETE_EXAM: { key: 'examIds', collection: 'exams', scoped: true },
  CREATE_RECURRING: { key: 'rules', collection: 'recurringRules', scoped: false },
  UPDATE_RECURRING: { key: 'rules', collection: 'recurringRules', scoped: false },
  DELETE_RECURRING: { key: 'recurringIds', collection: 'recurringRules', scoped: false },
  TOGGLE_RECURRING: { key: 'recurringIds', collection: 'recurringRules', scoped: false },
}
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function object(value: unknown, label: string): Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}必须是对象`)
  return value as Dict
}
function exact(value: Dict, keys: string[], label: string) {
  if (Object.keys(value).some((key) => !keys.includes(key) || BAD_KEYS.has(key)))
    throw new Error(`${label}包含不支持的字段`)
  if (keys.some((key) => !(key in value))) throw new Error(`${label}缺少必要字段，请补充信息`)
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label}超出有效范围`)
  return value
}
function text(value: unknown, label: string, max = 200, nullable = false): string | null {
  if (nullable && value === null) return null
  if (
    typeof value !== 'string' ||
    (!nullable && !value.trim()) ||
    value.length > max ||
    [...value].some((char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)))
  )
    throw new Error(`${label}无效`)
  if (/<\s*script\b|javascript\s*:|\bon\w+\s*=/i.test(value))
    throw new Error(`${label}包含可执行脚本标记，已阻止`)
  return value.trim()
}
export function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    y >= 1900 &&
    y <= 2200 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}
function clock(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))
    throw new Error(`${label}必须是有效的24小时时间`)
  return value.length === 5 ? `${value}:00` : value
}
function dateTime(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ||
    !validLocalDate(value.slice(0, 10))
  )
    throw new Error('截止日期时间无效，不允许缺省日期、时区偏移或自动进位')
  return `${value.slice(0, 10)}T${clock(value.slice(11), '截止时间')}`
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须明确为布尔值`)
  return value
}
function termWeeks(state: LocalState, scheduleId: number | null) {
  const schedule = state.schedules.find((row) => row.id === scheduleId)
  if (
    !schedule ||
    !validLocalDate(schedule.periodStartDate) ||
    !validLocalDate(schedule.periodEndDate)
  )
    throw new Error('请先选择有效课表')
  const start = new Date(`${schedule.periodStartDate}T00:00:00Z`)
  const end = new Date(`${schedule.periodEndDate}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  return Math.min(60, Math.floor((end.getTime() - start.getTime()) / 604800000) + 1)
}

function coursePayload(row: Dict, state: LocalState, scheduleId: number | null): Dict {
  const periods = new Set(state.periods.map((p) => p.periodNumber))
  const first = integer(row.startPeriod, 1, 24, '起始节次')
  const last = integer(row.endPeriod, first, 24, '结束节次')
  if (!periods.has(first) || !periods.has(last)) throw new Error('课程节次必须已在本机作息中定义')
  if (!Array.isArray(row.weeks) || !row.weeks.length || row.weeks.length > 60)
    throw new Error('必须明确课程周次')
  const weeks = row.weeks.map((w) => integer(w, 1, termWeeks(state, scheduleId), '教学周次'))
  if (new Set(weeks).size !== weeks.length) throw new Error('教学周次不能重复')
  return {
    name: text(row.name, '课程名称', 100),
    location: text(row.location, '地点', 100, true),
    teacher: text(row.teacher, '教师', 100, true),
    dayOfWeek: integer(row.dayOfWeek, 1, 7, '星期'),
    startPeriod: first,
    endPeriod: last,
    weeks: weeks.sort((a, b) => a - b),
  }
}

function examPayload(row: Dict): Dict {
  if (!validLocalDate(row.examDate)) throw new Error('考试日期无效')
  const startTime = clock(row.startTime, '考试开始时间')
  const endTime = clock(row.endTime, '考试结束时间')
  if (startTime >= endTime) throw new Error('考试结束时间必须晚于开始时间')
  return {
    name: text(row.name, '考试名称', 100),
    location: text(row.location, '地点', 100, true),
    examDate: row.examDate,
    startTime,
    endTime,
  }
}
function recurringPayload(row: Dict): Dict {
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(row.frequency)) || row.script !== null)
    throw new Error('AI仅可提议内置循环规则；CUSTOM脚本一律不执行')
  const frequency = row.frequency
  const dayOfWeek = frequency === 'WEEKLY' ? integer(row.dayOfWeek, 1, 7, '每周星期') : null
  const dayOfMonth = frequency === 'MONTHLY' ? integer(row.dayOfMonth, 1, 31, '每月日期') : null
  if (
    (frequency !== 'WEEKLY' && row.dayOfWeek !== null) ||
    (frequency !== 'MONTHLY' && row.dayOfMonth !== null)
  )
    throw new Error('循环规则频率与日期字段矛盾')
  return {
    title: text(row.title, '循环事项', 100),
    frequency,
    dayOfWeek,
    dayOfMonth,
    triggerTime: clock(row.triggerTime, '触发时间'),
    script: null,
    ddlOffsetMinutes: integer(row.ddlOffsetMinutes, 1, 5256000, '截止偏移'),
    enabled: bool(row.enabled, '启用状态'),
    chainAfterComplete: bool(row.chainAfterComplete, '链式生成'),
  }
}

function targetOf(proposal: DraftProposal, state: LocalState, scheduleId: number | null) {
  const kind = KINDS[proposal.type]
  const first = (proposal.data[kind.key] as unknown[])[0]
  const id = typeof first === 'number' ? first : (first as Dict).id
  if (proposal.type.startsWith('CREATE_')) return null
  const target = state[kind.collection].find((row) => row.id === id)
  if (!target || (kind.scoped && (target as { scheduleId?: number }).scheduleId !== scheduleId))
    throw new Error('目标记录不存在或不属于当前课表')
  // Exam-owned todos must be edited through the exam to preserve its local transaction linkage.
  if (kind.collection === 'todos' && 'examId' in target && target.examId != null)
    throw new Error('考试关联待办请通过考试提案修改，避免破坏关联')
  return target
}

export function normalizeProposals(
  value: unknown,
  state: LocalState,
  scheduleId: number | null,
): DraftProposal[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('AI动作必须是最多20项的列表')
  const result: DraftProposal[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const action = object(raw, '动作')
    exact(action, ['type', 'data'], '动作')
    if (
      typeof action.type !== 'string' ||
      !Object.prototype.hasOwnProperty.call(KINDS, action.type)
    )
      throw new Error('AI返回了不支持的动作类型')
    const type = action.type as AiActionType
    const kind = KINDS[type]
    if (kind.scoped && !state.schedules.some((row) => row.id === scheduleId))
      throw new Error('课程和考试提案必须绑定当前有效课表')
    const data = object(action.data, '动作内容')
    exact(data, [kind.key], '动作内容')
    const records = data[kind.key]
    if (!Array.isArray(records) || !records.length || records.length > 20)
      throw new Error('动作必须包含1到20条明确记录')
    for (const record of records) {
      let payload: unknown
      const creation = type.startsWith('CREATE_')
      if (type.startsWith('DELETE_') || type.startsWith('TOGGLE_'))
        payload = integer(record, 1, Number.MAX_SAFE_INTEGER, '记录ID')
      else {
        const row = object(record, '记录')
        const fields =
          kind.collection === 'courses'
            ? ['name', 'location', 'teacher', 'dayOfWeek', 'startPeriod', 'endPeriod', 'weeks']
            : kind.collection === 'todos'
              ? ['title', 'ddl']
              : kind.collection === 'exams'
                ? ['name', 'location', 'examDate', 'startTime', 'endTime']
                : [
                    'title',
                    'frequency',
                    'dayOfWeek',
                    'dayOfMonth',
                    'triggerTime',
                    'script',
                    'ddlOffsetMinutes',
                    'enabled',
                    'chainAfterComplete',
                  ]
        exact(row, creation ? fields : ['id', ...fields], '记录')
        const body =
          kind.collection === 'courses'
            ? coursePayload(row, state, scheduleId)
            : kind.collection === 'todos'
              ? { title: text(row.title, '待办标题', 100), ddl: dateTime(row.ddl) }
              : kind.collection === 'exams'
                ? examPayload(row)
                : recurringPayload(row)
        payload = creation
          ? body
          : { id: integer(row.id, 1, Number.MAX_SAFE_INTEGER, '记录ID'), ...body }
      }
      const proposal: DraftProposal = { type, data: { [kind.key]: [payload] } }
      const target = targetOf(proposal, state, scheduleId)
      const signature = `${kind.collection}:${creation ? `create:${JSON.stringify(payload)}` : target?.id}`
      if (seen.has(signature)) throw new Error('同一回复含重复或矛盾的目标操作，请拆开澄清')
      seen.add(signature)
      result.push(proposal)
      if (result.length > 20) throw new Error('单次最多20条记录，请分批处理')
    }
  }
  return result
}

export function parsePlannerReply(
  raw: string,
  state: LocalState,
  scheduleId: number | null,
  allowedTypes?: readonly AiActionType[],
): ValidatedReply {
  if (raw.length > 100000) throw new Error('AI回复过长，已停止')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('AI未返回完整JSON；没有生成可执行提案，请重试或换兼容模型')
  }
  const obj = object(parsed, 'AI回复')
  exact(obj, ['reply', 'actions'], 'AI回复')
  const reply = text(obj.reply, 'AI说明', 12000) as string
  const proposals = normalizeProposals(obj.actions, state, scheduleId)
  if (allowedTypes && proposals.some((proposal) => !allowedTypes.includes(proposal.type)))
    throw new Error(
      '当前导入草稿只授权新增待办或考试；修改、删除及其他动作已拒绝，请在普通对话中明确提出',
    )
  return { reply, proposals }
}

function basis(proposal: DraftProposal, state: LocalState, scheduleId: number | null) {
  const kind = KINDS[proposal.type]
  const schedule = kind.scoped ? state.schedules.find((row) => row.id === scheduleId) : null
  const target = targetOf(proposal, state, scheduleId)
  let targetBasis = target ? JSON.stringify(target) : null
  if (proposal.type.startsWith('CREATE_')) {
    const payload = (proposal.data[kind.key] as Dict[])[0]
    const matching = state[kind.collection].filter(
      (row) =>
        (!kind.scoped || (row as { scheduleId?: number }).scheduleId === scheduleId) &&
        Object.keys(payload).every(
          (key) => JSON.stringify((row as unknown as Dict)[key]) === JSON.stringify(payload[key]),
        ),
    )
    targetBasis = JSON.stringify(matching.map((row) => `${row.id}:${row.publicId}`).sort())
  }
  return {
    scheduleBasis: schedule
      ? JSON.stringify({
          id: schedule.id,
          publicId: schedule.publicId,
          name: schedule.name,
          periodStartDate: schedule.periodStartDate,
          periodEndDate: schedule.periodEndDate,
        })
      : null,
    targetBasis,
  }
}

export function materializeProposal(
  proposal: DraftProposal,
  state: LocalState,
  scheduleId: number | null,
  actionId: number,
  now = Date.now(),
): AiAction {
  const { scheduleBasis, targetBasis } = basis(proposal, state, scheduleId)
  const target = targetOf(proposal, state, scheduleId)
  const guard: Guard = {
    version: 1,
    datasetId: state.datasetId,
    scheduleBasis,
    targetBasis,
    payloadBasis: JSON.stringify(proposal.data),
    expiresAt: now + 30 * 60 * 1000,
  }
  return {
    actionId,
    type: proposal.type,
    status: 'PENDING',
    scope: KINDS[proposal.type].scoped ? 'COURSE' : 'TODO',
    scheduleId: KINDS[proposal.type].scoped ? scheduleId : null,
    data: { ...proposal.data, ...(target ? { _before: [target] } : {}), _guard: guard },
  }
}

export function checkedProposal(
  action: AiAction,
  state: LocalState,
  conversationScheduleId: number | null,
  now = Date.now(),
): DraftProposal {
  if (!Object.prototype.hasOwnProperty.call(KINDS, action.type))
    throw new Error('不支持的本地AI提案')
  const kind = KINDS[action.type]
  if (
    action.scope !== (kind.scoped ? 'COURSE' : 'TODO') ||
    (kind.scoped && action.scheduleId !== conversationScheduleId)
  )
    throw new Error('提案工作区不匹配')
  const guard = action.data?._guard as Guard | undefined
  if (
    !guard ||
    guard.version !== 1 ||
    guard.datasetId !== state.datasetId ||
    !Number.isFinite(guard.expiresAt) ||
    now > guard.expiresAt
  )
    throw new Error('提案已过期或来自其他数据集，请重新生成')
  const payload = { [kind.key]: action.data?.[kind.key] }
  if (guard.payloadBasis !== JSON.stringify(payload)) throw new Error('提案内容已变化，请重新生成')
  const proposal = normalizeProposals(
    [{ type: action.type, data: payload }],
    state,
    conversationScheduleId,
  )[0]
  const current = basis(proposal, state, conversationScheduleId)
  if (current.scheduleBasis !== guard.scheduleBasis || current.targetBasis !== guard.targetBasis)
    throw new Error('相关本地数据已变化，原提案已失效')
  return proposal
}

export function markStaleProposals(state: LocalState, now = Date.now()): void {
  for (const message of state.messages) {
    const conv = state.conversations.find((row) => row.id === message.conversationId)
    for (const action of message.actions ?? []) {
      if (action.status !== 'PENDING') continue
      try {
        if (!conv) throw new Error('对话已删除')
        checkedProposal(action, state, conv.scheduleId, now)
      } catch {
        action.status = 'STALE'
      }
    }
  }
}
