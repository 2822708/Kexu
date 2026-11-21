import { useEffect, useRef, useState } from 'react'
import { Button, DatePicker, Form, Input, message, Modal, Space } from 'antd'
import type { Dayjs } from 'dayjs'
import type { Schedule } from '../types'
import { validateSemesterRange } from '../utils/schedule'

interface Props {
  open: boolean
  onCancel: () => void
  onCreate: (payload: Omit<Schedule, 'id'>) => Promise<void>
  imageImport?: { kind: 'image' | 'document'; onSendWithoutSchedule: () => void }
}

interface FormValues {
  name: string
  range: [Dayjs, Dayjs]
}

export default function ScheduleCreateModal({ open, onCancel, onCreate, imageImport }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)
  const submitRef = useRef(false)

  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const submit = async () => {
    if (submitRef.current) return
    submitRef.current = true
    try {
      const values = await form.validateFields().catch(() => null)
      if (!values) return
      setSaving(true)
      try {
        await onCreate({
          name: values.name.trim(),
          periodStartDate: values.range[0].format('YYYY-MM-DD'),
          periodEndDate: values.range[1].format('YYYY-MM-DD'),
        })
        onCancel()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '保存失败')
      }
    } finally {
      submitRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      maskClosable={false}
      title={imageImport ? '为导入内容新建课表' : '新建课表'}
      onCancel={onCancel}
      closable={!saving}
      keyboard={!saving}
      footer={null}
      width={520}
      destroyOnHidden
    >
      {imageImport && <p>导入课程前需要目标课表。新建后会保留草稿，课程由你确认后写入。</p>}
      <Form form={form} layout="vertical" requiredMark={false} disabled={saving}>
        <Form.Item
          name="name"
          label="课表名称"
          rules={[{ required: true, message: '请输入课表名称' }]}
        >
          <Input placeholder="如 2025-2026 秋季学期" />
        </Form.Item>
        <Form.Item
          name="range"
          label="学期起止日期"
          rules={[
            { required: true, message: '请选择学期起止日期' },
            { validator: (_, value) => validateSemesterRange(value) },
          ]}
          extra="按实际日期填写。开始日期所在周计为第 1 周，每周从周一开始。"
        >
          <DatePicker.RangePicker style={{ width: '100%' }} />
        </Form.Item>
        <Space>
          <Button type="primary" loading={saving} onClick={submit}>
            {imageImport ? '创建课表' : '创建'}
          </Button>
          <Button onClick={onCancel}>取消</Button>
          {imageImport && (
            <Button type="link" onClick={imageImport.onSendWithoutSchedule}>
              {imageImport.kind === 'image' ? '仅识别图片' : '直接发送资料'}
            </Button>
          )}
        </Space>
      </Form>
    </Modal>
  )
}
