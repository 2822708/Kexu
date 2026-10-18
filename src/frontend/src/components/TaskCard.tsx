import { Space, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import { dayjs, formatCountdown } from '../utils/schedule'
import { taskPriorityLabel, taskTypeLabel } from '../utils/task'
import type { Task, TaskStatus } from '../types'

interface TaskCardProps {
  task: Task
  /** 展示用的当前时间（由页面级定时器驱动，保证倒计时刷新） */
  now?: Dayjs
  /** 附加说明，如「今天截止」「已逾期」——由调用方按业务判定 */
  hint?: string
  hintColor?: string
}

const OPEN_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS']

/** 中性药丸样式（无彩色语义的标签：类型 / 已取消） */
const NEUTRAL_PILL = { background: 'var(--b-bg-soft)', color: 'var(--b-ink-soft)' }

/** 调用方传入的 antd Tag 色名 → 明亮药丸变体（仅影响视觉，不改 props 语义） */
function hintPillVariant(color: string | undefined, overdue: boolean): string {
  switch (color) {
    case 'red':
    case 'volcano':
      return 'red'
    case 'orange':
      return 'yellow'
    case 'blue':
      return 'blue'
    case 'default':
      return 'neutral'
    default:
      return overdue ? 'red' : 'blue'
  }
}

/**
 * 任务卡片（AI Campus Agent V1.0 Step 5）。
 * Dashboard 今日任务/48h 截止区与后续任务管理页共用：
 * 优先级徽章 + 类型 + 截止倒计时 + 描述；已完成/已取消灰化。
 */
export default function TaskCard({ task, now, hint, hintColor }: TaskCardProps) {
  const current = now ?? dayjs()
  const settled = !OPEN_STATUSES.includes(task.status)
  const overdue =
    !settled && task.deadline != null && dayjs(task.deadline).isBefore(current)

  // 优先级 1 高 / 2 中 / 3 低 → 明亮药丸色系（原 antd Tag 红/橙/默认）
  const priorityVariant = task.priority === 1 ? 'red' : task.priority === 3 ? 'blue' : 'yellow'
  const hintVariant = hintPillVariant(hintColor, overdue)

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--b-radius-sm)',
        border: '1px solid var(--b-line)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--b-sh1)',
        opacity: settled ? 0.55 : 1,
      }}
    >
      <Space size={6} wrap style={{ marginBottom: 4 }}>
        <span className={`b-pill ${priorityVariant}`}>{taskPriorityLabel(task.priority)}优先级</span>
        <span className="b-pill" style={NEUTRAL_PILL}>
          {taskTypeLabel(task.type)}
        </span>
        {hint && (
          <span
            className={hintVariant === 'neutral' ? 'b-pill' : `b-pill ${hintVariant}`}
            style={hintVariant === 'neutral' ? NEUTRAL_PILL : undefined}
          >
            {hint}
          </span>
        )}
        {settled &&
          (task.status === 'DONE' ? (
            <span className="b-pill green">已完成</span>
          ) : (
            <span className="b-pill" style={NEUTRAL_PILL}>
              已取消
            </span>
          ))}
      </Space>
      <div>
        <Typography.Text strong delete={settled}>
          {task.title}
        </Typography.Text>
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
        {task.deadline ? (
          <>
            {dayjs(task.deadline).format('MM-DD HH:mm')} 截止
            {!settled && ` · ${formatCountdown(task.deadline, current)}`}
            {overdue && '（已逾期）'}
          </>
        ) : (
          '无截止时间'
        )}
      </div>
      {task.description && (
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.description}
        </div>
      )}
    </div>
  )
}
