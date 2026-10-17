import { dayjs } from './schedule'
import type { Task, TaskStatus, TaskType } from '../types'

/** 任务类型中文名（与后端白名单一致，顺序即展示顺序） */
export const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'COURSE_WORK', label: '课程作业' },
  { value: 'LAB_REPORT', label: '实验报告' },
  { value: 'ONLINE_COURSE', label: '网课' },
  { value: 'EXAM', label: '考试' },
  { value: 'COMPETITION', label: '竞赛' },
  { value: 'OTHER', label: '其他' },
]

export const TASK_TYPE_LABELS: Record<TaskType, string> = Object.fromEntries(
  TASK_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<TaskType, string>

/** 优先级：1 高 / 2 中 / 3 低（与后端一致） */
export const TASK_PRIORITY_LABELS: Record<number, string> = {
  1: '高',
  2: '中',
  3: '低',
}

/** 优先级徽章颜色（AntD Tag color） */
export const TASK_PRIORITY_COLORS: Record<number, string> = {
  1: 'red',
  2: 'orange',
  3: 'default',
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: '待开始',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  CANCELLED: '已取消',
}

export function taskTypeLabel(type: string | null | undefined): string {
  if (!type) return '其他'
  return TASK_TYPE_LABELS[type as TaskType] ?? type
}

export function taskPriorityLabel(priority: number | null | undefined): string {
  if (priority == null) return '中'
  return TASK_PRIORITY_LABELS[priority] ?? '中'
}

export function taskPriorityColor(priority: number | null | undefined): string {
  if (priority == null) return 'orange'
  return TASK_PRIORITY_COLORS[priority] ?? 'default'
}

/** 按客观截止时间推导的紧迫档位 */
export type UrgencyTier = 'high' | 'medium' | 'low'

export const URGENCY_LABELS: Record<UrgencyTier, string> = {
  high: '今日必做',
  medium: '建议完成',
  low: '可灵活延后',
}

export const URGENCY_COLORS: Record<UrgencyTier, string> = {
  high: 'red',
  medium: 'orange',
  low: 'default',
}

export interface UrgencyGroups {
  high: Task[]
  medium: Task[]
  low: Task[]
}

/**
 * 按**客观截止时间**把任务分成三档。
 *
 * 「今日必做」的分组依据是截止时间而不是用户设的 priority：这个页面的核心诉求是
 * **别漏事**，而客观截止时间压过主观设定——用户把一件事设成「低优先级」不代表
 * 它今天截止时可以不做。反过来，用户设成「高」但截止还有两周的事，也不该在今天
 * 抢占视觉焦点。
 *
 * 所以规则是：已逾期 / 今天截止 → 高；其余有截止的 → 中；无截止 → 低。
 * 前端不新增字段，priority 仍照常在卡片上显示，用户想改随时能改。
 */
export function groupTasksByUrgency(tasks: Task[], now = dayjs()): UrgencyGroups {
  const groups: UrgencyGroups = { high: [], medium: [], low: [] }
  // 先浅拷贝再排，不原地 mutate（项目惯例）
  const sorted = [...tasks].sort((a, b) => {
    if (a.deadline == null && b.deadline == null) return (a.id ?? 0) - (b.id ?? 0)
    if (a.deadline == null) return 1
    if (b.deadline == null) return -1
    return dayjs(a.deadline).valueOf() - dayjs(b.deadline).valueOf()
  })
  for (const task of sorted) {
    if (task.deadline == null) {
      groups.low.push(task)
      continue
    }
    const deadline = dayjs(task.deadline)
    // 已逾期或今天截止 → 强制置顶，压过用户主观 priority
    if (deadline.isBefore(now) || deadline.isSame(now, 'day')) {
      groups.high.push(task)
    } else {
      groups.medium.push(task)
    }
  }
  return groups
}

/** 这条任务是不是因为临近截止才被置顶的（卡片上要标出来，否则用户会以为是改了他的设置） */
export function isAutoEscalated(task: Task, now = dayjs()): boolean {
  if (task.deadline == null) return false
  const deadline = dayjs(task.deadline)
  const urgent = deadline.isBefore(now) || deadline.isSame(now, 'day')
  return urgent && task.priority !== 1
}
