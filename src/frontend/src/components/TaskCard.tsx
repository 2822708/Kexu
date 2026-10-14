import { Space, Tag, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import { dayjs, formatCountdown } from '../utils/schedule'
import { taskPriorityColor, taskPriorityLabel, taskTypeLabel } from '../utils/task'
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

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-light)',
        background: 'var(--bg-card)',
        opacity: settled ? 0.55 : 1,
      }}
    >
      <Space size={6} wrap style={{ marginBottom: 4 }}>
        <Tag color={taskPriorityColor(task.priority)} style={{ marginInlineEnd: 0 }}>
          {taskPriorityLabel(task.priority)}优先级
        </Tag>
        <Tag style={{ marginInlineEnd: 0 }}>{taskTypeLabel(task.type)}</Tag>
        {hint && (
          <Tag color={hintColor ?? (overdue ? 'red' : 'blue')} style={{ marginInlineEnd: 0 }}>
            {hint}
          </Tag>
        )}
        {settled && (
          <Tag style={{ marginInlineEnd: 0 }}>
            {task.status === 'DONE' ? '已完成' : '已取消'}
          </Tag>
        )}
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
