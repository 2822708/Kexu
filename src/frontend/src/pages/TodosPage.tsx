import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RetweetOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'
import RecurringTodoPanel from '../components/RecurringTodoPanel'
import DailyTaskIndex from '../components/daily/DailyTaskIndex'
import type { Dayjs } from 'dayjs'
import { todoApi } from '../api'
import { useApp } from '../store/AppContext'
import type { Todo } from '../types'
import { dayjs, formatCountdown } from '../utils/schedule'
import { LOCAL_MODE } from '../local/mode'
import '../daily-pages.css'

type Filter = 'active' | 'completed' | 'all'

export default function TodosPage() {
  const {
    todos,
    recurringTodos,
    refreshTodos,
    refreshRecurring,
    refreshSchedules,
    setActiveScheduleId,
  } = useApp()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('active')
  const [tick, setTick] = useState(0)
  const [modal, setModal] = useState<{ open: boolean; todo: Todo | null }>({
    open: false,
    todo: null,
  })
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{ title: string; ddl: Dayjs }>()

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const now = useMemo(() => dayjs(), [tick])

  const visible = useMemo(() => {
    const list = [...todos].sort((a, b) => dayjs(a.ddl).valueOf() - dayjs(b.ddl).valueOf())
    if (filter === 'active') return list.filter((t) => !t.completed)
    if (filter === 'completed') return list.filter((t) => t.completed)
    return list
  }, [todos, filter])

  // 循环待办的来源规则标题（规则被删除时返回 null）
  const recurringSource = (id: number) => recurringTodos.find((r) => r.id === id)?.title ?? null

  const stats = useMemo(() => {
    const active = todos.filter((t) => !t.completed)
    const overdue = active.filter((t) => dayjs(t.ddl).isBefore(now))
    const soon = active.filter(
      (t) => !dayjs(t.ddl).isBefore(now) && dayjs(t.ddl).diff(now, 'hour') < 24,
    )
    return { active: active.length, overdue: overdue.length, soon: soon.length }
  }, [todos, now])

  const groups = useMemo(() => {
    const buckets: { key: string; title: string; items: Todo[]; danger?: boolean }[] = [
      { key: 'overdue', title: '已逾期', items: [], danger: true },
      { key: 'today', title: '今天截止', items: [] },
      { key: 'later', title: '接下来', items: [] },
      { key: 'completed', title: '已完成', items: [] },
    ]
    for (const todo of visible) {
      const index = todo.completed ? 3 : dayjs(todo.ddl).isBefore(now) ? 0 : dayjs(todo.ddl).isSame(now, 'day') ? 1 : 2
      buckets[index].items.push(todo)
    }
    return buckets.filter((bucket) => bucket.items.length > 0)
  }, [visible, now])

  const manageExam = async (todo: Todo) => {
    if (!LOCAL_MODE || todo.examId == null) return
    try {
      const { readLocalState } = await import('../local/db')
      const state = await readLocalState()
      const exam = state.exams.find((item) => item.id === todo.examId)
      if (!exam) {
        message.info('这场考试已被删除，请刷新待办列表。')
        return
      }
      const schedules = await refreshSchedules()
      if (!schedules.some((item) => item.id === exam.scheduleId)) {
        message.info('考试所属课表已被删除，请刷新待办列表。')
        return
      }
      setActiveScheduleId(exam.scheduleId)
      navigate('/timetable')
      message.info('已切换到考试所属课表，请在「更多 → 考试管理」修改；关联待办会同步更新。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法打开考试所属课表')
    }
  }

  const openModal = (todo: Todo | null) => {
    if (LOCAL_MODE && todo?.examId != null) {
      void manageExam(todo)
      return
    }
    setModal({ open: true, todo })
    if (todo) {
      form.setFieldsValue({ title: todo.title, ddl: dayjs(todo.ddl) })
    } else {
      form.resetFields()
      form.setFieldsValue({ ddl: dayjs().add(1, 'day').hour(23).minute(59) })
    }
  }

  const submit = async () => {
    const values = await form.validateFields()
    const payload = {
      title: values.title.trim(),
      ddl: values.ddl.format('YYYY-MM-DDTHH:mm:ss'),
    }
    setSaving(true)
    try {
      if (modal.todo) {
        await todoApi.update(modal.todo.id, payload)
        message.success('待办已更新')
      } else {
        await todoApi.create(payload)
        message.success('待办已创建')
      }
      setModal({ open: false, todo: null })
      await refreshTodos()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (todo: Todo) => {
    try {
      await todoApi.toggle(todo.id)
      await Promise.all([refreshTodos(), refreshRecurring()])
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const remove = async (todo: Todo) => {
    try {
      await todoApi.remove(todo.id)
      message.success('待办已删除')
      await refreshTodos()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const todoTab = (
    <>
      <div className="todo-filter-toolbar">
          <Segmented
            aria-label="待办显示范围"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: 'active', label: '未完成' },
              { value: 'completed', label: '已完成' },
              { value: 'all', label: '全部' },
            ]}
          />
        <div className="todo-summary-line">
          <span>待完成 <strong>{stats.active}</strong></span>
          <span>24小时内 <strong>{stats.soon}</strong></span>
          {stats.overdue > 0 && <span className="daily-danger">逾期 <strong>{stats.overdue}</strong></span>}
        </div>
      </div>

      <Typography.Paragraph className="todo-notification-note" type="secondary">
        倒计时仅在页面内显示；当前版本不会发送系统通知，关闭页面后也不会弹窗提醒。
      </Typography.Paragraph>
      {groups.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === 'completed' ? '还没有已完成的待办' : '暂无待办'} />}
      {groups.map((group) => (
      <section key={group.key} className="todo-group" aria-label={group.title}>
        <div className={`todo-group-heading${group.danger ? ' daily-danger' : ''}`}>
          <Typography.Title level={4} style={{ margin: 0 }}>{group.title}</Typography.Title>
          <span>{group.items.length} 项</span>
        </div>
        <Card className="todo-list-surface" styles={{ body: { padding: '0 16px' } }}>
        <List
          dataSource={group.items}
          locale={{ emptyText: <Empty description="暂无待办" /> }}
          renderItem={(todo) => {
            const ddl = dayjs(todo.ddl)
            const overdue = !todo.completed && ddl.isBefore(now)
            const urgent = !todo.completed && !overdue && ddl.diff(now, 'hour') < 24
            return (
              <List.Item
                className="todo-record"
                actions={[
                  LOCAL_MODE && todo.examId != null ? (
                    <Button
                      key="exam"
                      type="text"
                      aria-label={`管理考试 ${todo.title}`}
                      icon={<ScheduleOutlined />}
                      onClick={() => void manageExam(todo)}
                    >
                      考试管理
                    </Button>
                  ) : (
                    <Button
                      key="edit"
                      type="text"
                      aria-label={`编辑待办 ${todo.title}`}
                      icon={<EditOutlined />}
                      onClick={() => openModal(todo)}
                    />
                  ),
                  <Popconfirm
                    key="del"
                    title="确定删除该待办吗？"
                    description={
                      LOCAL_MODE && todo.examId != null
                        ? '只删除关联待办，考试记录会保留。'
                        : undefined
                    }
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => remove(todo)}
                  >
                    <Button
                      type="text"
                      danger
                      aria-label={`删除待办 ${todo.title}`}
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Checkbox
                      aria-label={`完成待办 ${todo.title}`}
                      checked={todo.completed}
                      onChange={() => toggle(todo)}
                      style={{ marginTop: 4 }}
                    />
                  }
                  title={
                    <Space wrap>
                      <Typography.Text
                        delete={todo.completed}
                        type={todo.completed ? 'secondary' : undefined}
                      >
                        {todo.title}
                      </Typography.Text>
                      {todo.recurringId != null && (
                        <Tooltip
                          title={
                            recurringSource(todo.recurringId)
                              ? `来自循环任务：${recurringSource(todo.recurringId)}`
                              : '来自循环任务（规则已删除）'
                          }
                        >
                          <Tag icon={<RetweetOutlined />} color="blue">
                            循环
                          </Tag>
                        </Tooltip>
                      )}
                      {todo.examId != null && (
                        <Tooltip
                          title={
                            LOCAL_MODE
                              ? '来自考试：截止时间随考试同步；请点「考试管理」修改，应用运行时在考试结束后自动完成。'
                              : '来自考试：ddl=考试开始时间，考试结束后自动完成'
                          }
                        >
                          <Tag icon={<ScheduleOutlined />} color="red">
                            考试
                          </Tag>
                        </Tooltip>
                      )}
                      {todo.completed ? (
                        <Tag color="green">已完成</Tag>
                      ) : (
                        <Tag color={overdue ? 'red' : urgent ? 'orange' : 'blue'}>
                          {overdue ? '已逾期' : formatCountdown(todo.ddl, now)}
                        </Tag>
                      )}
                    </Space>
                  }
                  description={
                    <div className="todo-record-details">
                      <span>截止 {ddl.format('YYYY-MM-DD HH:mm')}</span>
                      {todo.recurringId != null && <span>来源：{recurringSource(todo.recurringId) ?? '循环规则已删除'}</span>}
                      {todo.examId != null && <span>来源：考试安排 · 截止随考试同步</span>}
                    </div>
                  }
                />
              </List.Item>
            )
          }}
        />
        </Card>
      </section>
      ))}
    </>
  )

  return (
    <div className="daily-todos-page">
      <div className="page-header daily-page-header">
        <div className="daily-page-heading">
          <Typography.Title level={2} style={{ margin: 0 }}>待办</Typography.Title>
          <Typography.Text type="secondary">按截止时间整理任务，循环安排也在这里。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>新建待办</Button>
      </div>
      <Tabs
        className="daily-todo-tabs"
        items={[
          { key: 'todos', label: '待办事项', children: todoTab },
          ...(LOCAL_MODE ? [{ key: 'daily', label: '日任务', children: <DailyTaskIndex /> }] : []),
          {
            key: 'recurring',
            label: `循环任务${recurringTodos.length ? ` (${recurringTodos.length})` : ''}`,
            children: <RecurringTodoPanel />,
          },
        ]}
      />

      <Modal
        open={modal.open}
        maskClosable={false}
        title={modal.todo ? '编辑待办' : '新建待办'}
        onCancel={() => setModal({ open: false, todo: null })}
        onOk={submit}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入待办标题' }]}
          >
            <Input placeholder="如 交高数作业" />
          </Form.Item>
          <Form.Item
            name="ddl"
            label="截止时间"
            rules={[{ required: true, message: '请选择截止时间' }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
