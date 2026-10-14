import { useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Input, Modal, Select, Space, Typography } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { dayjs } from '../utils/schedule'
import { TASK_PRIORITY_LABELS, TASK_TYPE_OPTIONS } from '../utils/task'
import type { TaskDraft, TaskExtractResult } from '../types'

const PRIORITY_OPTIONS = [1, 2, 3].map((value) => ({
  value,
  label: `${TASK_PRIORITY_LABELS[value]}优先级`,
}))

interface TaskDraftModalProps {
  open: boolean
  result: TaskExtractResult | null
  confirming: boolean
  error: string
  onCancel: () => void
  onConfirm: (drafts: TaskDraft[]) => void
}

/**
 * 任务草稿核对模态（AI Campus Agent V1.0 Step 4，human-in-the-loop）。
 *
 * AI 抽取的草稿一律不直接落库：用户在此逐条核对/编辑（标题、类型、截止时间、
 * 优先级、描述），确认后才批量创建。confidence < 0.6 时醒目提示强制人工核对。
 */
export default function TaskDraftModal({
  open, result, confirming, error, onCancel, onConfirm,
}: TaskDraftModalProps) {
  const [drafts, setDrafts] = useState<TaskDraft[]>([])

  useEffect(() => {
    if (open && result) {
      setDrafts(result.tasks.map((task) => ({ ...task })))
    }
  }, [open, result])

  const patch = (index: number, changes: Partial<TaskDraft>) => {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...changes } : draft)))
  }

  const remove = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
  }

  const titlesReady = drafts.length > 0 && drafts.every((draft) => draft.title.trim().length > 0)

  return (
    <Modal
      title="确认任务草稿"
      open={open}
      onCancel={onCancel}
      width={680}
      centered
      okText={drafts.length > 0 ? `创建 ${drafts.length} 个任务` : '创建任务'}
      cancelText="取消"
      confirmLoading={confirming}
      okButtonProps={{ disabled: !titlesReady }}
      onOk={() => onConfirm(drafts.map((draft) => ({ ...draft, title: draft.title.trim() })))}
      styles={{ body: { maxHeight: 'min(66vh, 560px)', overflowY: 'auto', paddingRight: 4 } }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ display: 'flex' }}>
        {result && result.confidence < 0.6 && (
          <Alert
            type="warning"
            showIcon
            message="AI 对这份材料把握较低，请逐条核对标题、截止时间和类型后再创建。"
          />
        )}
        {result?.note ? <Alert type="info" showIcon message={result.note} /> : null}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {drafts.length === 0 && (
          <Typography.Text type="secondary">没有可创建的任务，可以取消后手动创建。</Typography.Text>
        )}
        {drafts.map((draft, index) => (
          <Space
            key={index}
            direction="vertical"
            size={8}
            style={{
              display: 'flex',
              padding: '10px 12px',
              border: '1px solid var(--border-light)',
              borderRadius: 8,
              background: 'var(--bg-card)',
            }}
          >
            <Space align="start" style={{ display: 'flex' }}>
              <Input
                value={draft.title}
                maxLength={50}
                showCount
                placeholder="任务标题（必填）"
                onChange={(event) => patch(index, { title: event.target.value })}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="删除该草稿"
                onClick={() => remove(index)}
              />
            </Space>
            <Space wrap>
              <Select
                aria-label="任务类型"
                value={draft.type}
                options={TASK_TYPE_OPTIONS}
                style={{ width: 110 }}
                onChange={(value) => patch(index, { type: value })}
              />
              <Select
                aria-label="优先级"
                value={draft.priority}
                options={PRIORITY_OPTIONS}
                style={{ width: 100 }}
                onChange={(value) => patch(index, { priority: value })}
              />
              <DatePicker
                showTime
                allowClear
                placeholder="截止时间（可不填）"
                value={draft.deadline ? dayjs(draft.deadline) : null}
                format="YYYY-MM-DD HH:mm"
                onChange={(value: Dayjs | null) =>
                  patch(index, { deadline: value ? value.format('YYYY-MM-DDTHH:mm:ss') : null })}
              />
            </Space>
            <Input.TextArea
              value={draft.description}
              maxLength={200}
              showCount
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="补充说明（可选）"
              onChange={(event) => patch(index, { description: event.target.value })}
            />
          </Space>
        ))}
      </Space>
    </Modal>
  )
}
