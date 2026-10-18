import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  TimePicker,
  Typography,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { Exam, ExamPayload } from '../types'
import { dayjs, WEEK_DAY_NAMES } from '../utils/schedule'

interface Props {
  open: boolean
  exams: Exam[]
  saving: boolean
  onCancel: () => void
  onCreate: (payload: ExamPayload) => Promise<void>
  onUpdate: (id: number, payload: ExamPayload) => Promise<void>
  onDelete: (exam: Exam) => Promise<void>
}

interface FormValues {
  name: string
  location?: string
  examDate: unknown
  startTime: unknown
  endTime: unknown
}

export default function ExamManagerModal({
  open,
  exams,
  saving,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState<Exam | null | 'new'>(null)
  const [form] = Form.useForm<FormValues>()

  const sorted = useMemo(
    () => [...exams].sort((a, b) => a.examDate.localeCompare(b.examDate)),
    [exams],
  )

  useEffect(() => {
    if (!open) {
      setEditing(null)
      form.resetFields()
    }
  }, [open, form])

  const openCreate = () => {
    setEditing('new')
    form.resetFields()
    form.setFieldsValue({
      examDate: dayjs(),
      startTime: dayjs('09:00', 'HH:mm'),
      endTime: dayjs('11:00', 'HH:mm'),
    })
  }

  const openEdit = (exam: Exam) => {
    setEditing(exam)
    form.setFieldsValue({
      name: exam.name,
      location: exam.location ?? undefined,
      examDate: dayjs(exam.examDate),
      startTime: dayjs(exam.startTime.slice(0, 5), 'HH:mm'),
      endTime: dayjs(exam.endTime.slice(0, 5), 'HH:mm'),
    })
  }

  const toPayload = (v: FormValues): ExamPayload => ({
    name: v.name.trim(),
    location: v.location?.trim() || null,
    examDate: (v.examDate as { format: (f: string) => string }).format('YYYY-MM-DD'),
    startTime: (v.startTime as { format: (f: string) => string }).format('HH:mm'),
    endTime: (v.endTime as { format: (f: string) => string }).format('HH:mm'),
  })

  const handleOk = async () => {
    const values = await form.validateFields()
    const payload = toPayload(values)
    if (editing === 'new') await onCreate(payload)
    else if (editing) await onUpdate(editing.id, payload)
    setEditing(null)
  }

  const isEditing = editing !== null

  return (
    <>
      <Modal
        open={open}
        onCancel={onCancel}
        title="考试管理"
        width={720}
        footer={
          <Button type="primary" className="b-btn-3d blue" style={{ background: 'var(--b-blue)' }} onClick={onCancel}>
            关闭
          </Button>
        }
      >
        <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type="secondary">
            共 {sorted.length} 条考试记录（按日期/时间显示在课表上）
          </Typography.Text>
          <Button
            type="primary"
            className="b-btn-3d"
            style={{ background: 'var(--b-green)' }}
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            添加考试
          </Button>
        </Space>
        {sorted.length === 0 ? (
          <Typography.Text type="secondary">还没有考试记录</Typography.Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map((e) => {
              const d = dayjs(e.examDate)
              const daysLeft = d.startOf('day').diff(dayjs().startOf('day'), 'day')
              const soon = daysLeft >= 0 && daysLeft <= 7
              const countdown = daysLeft > 0 ? `${daysLeft} 天后` : daysLeft === 0 ? '今天' : `已过 ${-daysLeft} 天`
              return (
                <div
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--b-bg-soft)',
                    borderRadius: 'var(--b-radius-sm)',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--b-ink)' }}>{e.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--b-ink-soft)', marginTop: 2 }}>
                      {e.examDate}（{WEEK_DAY_NAMES[d.day() === 0 ? 6 : d.day() - 1]}）· {e.location || '—'}
                    </div>
                  </div>
                  <span className={`b-pill ${soon ? 'red' : 'blue'}`}>
                    {e.startTime?.slice(0, 5)}–{e.endTime?.slice(0, 5)}
                  </span>
                  <div
                    style={{
                      flex: 'none',
                      minWidth: 64,
                      textAlign: 'right',
                      fontWeight: 900,
                      fontSize: 14,
                      color: soon ? 'var(--b-red-ink)' : 'var(--b-ink-soft)',
                    }}
                  >
                    {countdown}
                  </div>
                  <Space size={0}>
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(e)} />
                    <Popconfirm
                      title="确定删除这条考试记录吗？"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => onDelete(e)}
                    >
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={isEditing}
        title={editing === 'new' ? '添加考试' : '编辑考试'}
        onCancel={() => setEditing(null)}
        width={520}
        destroyOnHidden
        footer={
          <Space>
            <Button className="b-btn-3d blue" style={{ background: 'var(--b-blue)' }} onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" className="b-btn-3d" style={{ background: 'var(--b-green)' }} loading={saving} onClick={handleOk}>
              保存
            </Button>
          </Space>
        }
      >
        {/* 表单容器：白底卡片 + 大圆角 + 柔影（明亮风）；内部控件保持 antd 原样 */}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--b-radius)',
            boxShadow: 'var(--b-sh2)',
            padding: '16px 18px 0',
          }}
        >
          <Form.Item
            name="name"
            label="考试名称"
            rules={[{ required: true, message: '请输入考试名称' }]}
          >
            <Input placeholder="如 期末考试 / CET-6 / 业余无线电A类考试" />
          </Form.Item>
          <Space size={12} wrap style={{ display: 'flex' }}>
            <Form.Item
              name="examDate"
              label="考试日期"
              rules={[{ required: true, message: '请选择日期' }]}
              style={{ flex: 1, minWidth: 150 }}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="startTime"
              label="开始时间"
              rules={[{ required: true, message: '请选择' }]}
              style={{ flex: 1, minWidth: 120 }}
            >
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="endTime"
              label="结束时间"
              rules={[{ required: true, message: '请选择' }]}
              style={{ flex: 1, minWidth: 120 }}
            >
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="location" label="考试地点（可留空）">
            <Input placeholder="如 教3-101" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
