import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Alert,
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
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  CalendarOutlined,
  EditOutlined,
  PlusOutlined,
  RetweetOutlined,
  ScheduleOutlined,
} from '@ant-design/icons'
import RecurringTodoPanel from '../components/RecurringTodoPanel'
import type { Dayjs } from 'dayjs'
import { todoApi } from '../api'
import { useApp } from '../store/AppContext'
import type { Todo } from '../types'
import { dayjs, formatCountdown } from '../utils/schedule'
import { LOCAL_MODE } from '../local/mode'
import { useDailyWorkspace } from '../hooks/useDailyWorkspace'
import { dailyApi } from '../local/daily/commands'
import { nowLocalDateTime } from '../local/domain'
import type { DailyWorkspace, DayEntry } from '../local/daily/types'
import '../daily-pages.css'

type Filter = 'active' | 'completed' | 'all'
type DayTask = Extract<DayEntry, { kind: 'dayTask' }>
type TaskRecord = { kind: 'todo'; value: Todo } | { kind: 'dayTask'; value: DayTask }
type TodosPageProps = { embedded?: boolean }

export default function TodosPage(props: TodosPageProps) {
  return LOCAL_MODE ? <LocalTodosPage {...props} /> : <TodosPageContent {...props} />
}

function LocalTodosPage(props: TodosPageProps) {
  const [date, setDate] = useState(() => nowLocalDateTime().slice(0, 10))
  const { workspace, error, refresh } = useDailyWorkspace(date)
  useEffect(() => {
    const timer = window.setInterval(() => setDate(nowLocalDateTime().slice(0, 10)), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <TodosPageContent {...props} dailyWorkspace={workspace} dailyError={error} refreshDaily={refresh} />
}

function TodosPageContent({ embedded = false, dailyWorkspace, dailyError, refreshDaily }: TodosPageProps & {
  dailyWorkspace?: DailyWorkspace | null
  dailyError?: string
  refreshDaily?: () => Promise<DailyWorkspace>
}) {
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
  const [tick, setTick] = useState(Date.now)
  const [modal, setModal] = useState<{ open: boolean; todo: Todo | null }>({
    open: false,
    todo: null,
  })
  const [saving, setSaving] = useState(false)
  const busyRef = useRef(new Set<string>())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [form] = Form.useForm<{ title: string; ddl: Dayjs }>()

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const now = useMemo(() => dayjs(tick), [tick])

  const records = useMemo<TaskRecord[]>(() => [
    ...todos.map((value) => ({ kind: 'todo' as const, value })),
    ...(dailyWorkspace?.state.dayEntries ?? [])
      .filter((entry): entry is DayTask => entry.kind === 'dayTask')
      .map((value) => ({ kind: 'dayTask' as const, value })),
  ], [todos, dailyWorkspace])

  const visible = useMemo(() => {
    const dateOf = (item: TaskRecord) => item.kind === 'todo' ? item.value.ddl : item.value.plannedDate
    const list = [...records].sort((a, b) => dayjs(dateOf(a)).valueOf() - dayjs(dateOf(b)).valueOf())
    if (filter === 'active') return list.filter((t) => !t.value.completed)
    if (filter === 'completed') return list.filter((t) => t.value.completed)
    return list
  }, [records, filter])

  // 循环待办的来源规则标题（规则被删除时返回 null）
  const recurringSource = (id: number) => recurringTodos.find((r) => r.id === id)?.title ?? null

  const stats = useMemo(() => {
    const active = todos.filter((t) => !t.completed)
    const overdue = active.filter((t) => dayjs(t.ddl).isBefore(now))
    const soon = active.filter(
      (t) => !dayjs(t.ddl).isBefore(now) && dayjs(t.ddl).diff(now, 'hour') < 24,
    )
    const dailyActive = (dailyWorkspace?.state.dayEntries ?? []).filter((entry) => entry.kind === 'dayTask' && !entry.completed).length
    return { active: active.length + dailyActive, overdue: overdue.length, soon: soon.length }
  }, [todos, now, dailyWorkspace])

  const groups = useMemo(() => {
    const buckets: { key: string; title: string; items: TaskRecord[]; danger?: boolean }[] = [
      { key: 'overdue', title: '已逾期', items: [], danger: true },
      { key: 'past', title: '往日安排', items: [] },
      { key: 'today', title: '今天', items: [] },
      { key: 'later', title: '接下来', items: [] },
      { key: 'completed', title: '已完成', items: [] },
    ]
    for (const item of visible) {
      const index = item.value.completed ? 4
        : item.kind === 'todo' && dayjs(item.value.ddl).isBefore(now) ? 0
        : item.kind === 'dayTask' && item.value.plannedDate < (dailyWorkspace?.date ?? now.format('YYYY-MM-DD')) ? 1
        : dayjs(item.kind === 'todo' ? item.value.ddl : item.value.plannedDate).isSame(now, 'day') ? 2 : 3
      buckets[index].items.push(item)
    }
    return buckets.filter((bucket) => bucket.items.length > 0)
  }, [visible, now, dailyWorkspace?.date])

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busyRef.current.has(key)) return
    busyRef.current.add(key)
    setBusy(new Set(busyRef.current))
    try {
      await action()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败，请刷新后重试')
    } finally {
      busyRef.current.delete(key)
      setBusy(new Set(busyRef.current))
    }
  }
  const plannedToday = (todo: Todo) => {
    const source = dailyWorkspace?.state.todos.find((item) => item.id === todo.id)
    return !!source && dailyWorkspace!.state.dayEntries.some((entry) =>
      entry.kind === 'todo' && entry.todoPublicId === source.publicId && entry.plannedDate === dailyWorkspace!.date,
    )
  }
  const planToday = (todo: Todo) => void run(`plan:${todo.id}`, async () => {
    if (!dailyWorkspace || !refreshDaily) return
    const source = dailyWorkspace.state.todos.find((item) => item.id === todo.id)
    if (!source) throw new Error('任务已移除，请刷新后重试')
    const result = await dailyApi.planTodo({
      date: dailyWorkspace.date,
      todoPublicId: source.publicId,
      expectedGeneration: dailyWorkspace.generation,
      operationId: crypto.randomUUID(),
    })
    await refreshDaily()
    message.success(result.changed ? '已加入今日' : '这件事已在今日清单中')
  })

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

  const toggleDayTask = (entry: DayTask) => void run(`day:${entry.publicId}`, async () => {
    if (!dailyWorkspace || !refreshDaily) return
    await dailyApi.setCompleted({
      entryPublicId: entry.publicId,
      completed: !entry.completed,
      expectedVersion: entry.version,
      expectedGeneration: dailyWorkspace.generation,
      operationId: crypto.randomUUID(),
    })
    await refreshDaily()
  })

  const todoTab = (
    <>
      <div className="todo-filter-toolbar">
          <Segmented
            aria-label="任务显示范围"
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
      {dailyError && <Alert type="error" message={dailyError} action={<Button onClick={() => void refreshDaily?.().catch(() => undefined)}>重试</Button>} />}
      {LOCAL_MODE && !dailyWorkspace && !dailyError && <Spin tip="正在读取日任务"><div style={{ minHeight: 48 }} /></Spin>}
      {groups.length === 0 && (!LOCAL_MODE || dailyWorkspace) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === 'completed' ? '还没有已完成的任务' : '暂无任务'} />}
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
          rowKey={(record) => record.kind === 'todo' ? `todo:${record.value.id}` : `day:${record.value.publicId}`}
          renderItem={(record) => {
            if (record.kind === 'dayTask') {
              const entry = record.value
              const canToggle = entry.plannedDate === dailyWorkspace?.date
              return (
                <List.Item
                  className="todo-record"
                  actions={[
                    <Button
                      key="open"
                      type="text"
                      aria-label={`打开任务 ${entry.title}`}
                      onClick={() => navigate(`/tasks?date=${entry.plannedDate}`)}
                    >
                      打开
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Tooltip title={canToggle ? undefined : '打开计划日后，可调整计划或更正记录'}>
                        <Checkbox
                          aria-label={`完成日任务 ${entry.title}`}
                          checked={entry.completed}
                          disabled={!canToggle || busy.has(`day:${entry.publicId}`)}
                          onChange={() => toggleDayTask(entry)}
                          style={{ marginTop: 4 }}
                        />
                      </Tooltip>
                    }
                    title={
                      <Space wrap>
                        <Typography.Text delete={entry.completed} type={entry.completed ? 'secondary' : undefined}>
                          {entry.title}
                        </Typography.Text>
                        {entry.completed && <Tag color="green">已完成</Tag>}
                      </Space>
                    }
                    description={<div className="todo-record-details"><span>计划日 {entry.plannedDate}</span></div>}
                  />
                </List.Item>
              )
            }
            const todo = record.value
            const ddl = dayjs(todo.ddl)
            const overdue = !todo.completed && ddl.isBefore(now)
            const urgent = !todo.completed && !overdue && ddl.diff(now, 'hour') < 24
            return (
              <List.Item
                className="todo-record"
                actions={[
                  ...(LOCAL_MODE && !todo.completed && todo.examId == null ? [
                    <Button
                      key="plan"
                      type="text"
                      icon={<CalendarOutlined />}
                      aria-label={`${plannedToday(todo) ? '已在今日' : '加入今日'} ${todo.title}`}
                      disabled={!dailyWorkspace || plannedToday(todo)}
                      loading={busy.has(`plan:${todo.id}`)}
                      onClick={() => planToday(todo)}
                    >
                      {plannedToday(todo) ? '已在今日' : '加入今日'}
                    </Button>,
                  ] : []),
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
                      disabled={busy.has(`todo:${todo.id}`)}
                      onChange={() => void run(`todo:${todo.id}`, () => toggle(todo))}
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
    <div className={`daily-todos-page${embedded ? ' task-pool' : ''}`}>
      {embedded ? (
        <div className="task-pool-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>新建任务</Button>
        </div>
      ) : (
      <div className="page-header daily-page-header">
        <div className="daily-page-heading">
          <Typography.Title level={2} style={{ margin: 0 }}>待办</Typography.Title>
          <Typography.Text type="secondary">按截止时间整理任务，循环安排也在这里。</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal(null)}>新建待办</Button>
      </div>
      )}
      {embedded ? todoTab : (
      <Tabs
        className="daily-todo-tabs"
        items={[
          { key: 'todos', label: '待办事项', children: todoTab },
          {
            key: 'recurring',
            label: `循环任务${recurringTodos.length ? ` (${recurringTodos.length})` : ''}`,
            children: <RecurringTodoPanel />,
          },
        ]}
      />
      )}

      <Modal
        open={modal.open}
        maskClosable={false}
        title={modal.todo ? '编辑任务' : '新建任务'}
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
