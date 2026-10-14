import type { TaskStatus, TaskType } from '../types'

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
