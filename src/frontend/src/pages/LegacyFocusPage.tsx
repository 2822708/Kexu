import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  FieldTimeOutlined,
  LeftOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  RightOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { focusApi, todoApi } from '../api'
import { useApp } from '../store/AppContext'
import type { Course, Todo } from '../types'
import { dayjs } from '../utils/schedule'
import { dayAgenda } from '../utils/dayAgenda'
import '../daily-pages.css'

type FocusTarget = {
  key: string
  kind: 'course' | 'todo'
  id: number
  title: string
}

type TimerRecord = {
  target: FocusTarget
  phase: 'focus' | 'break'
  focusMinutes: number
  remainingSeconds: number
  endsAt: number | null
  running: boolean
}

type TimerStore = { active: TimerRecord | null; paused: TimerRecord[] }

const TIMER_STORAGE = 'timetable.focus.timer.v1'
const DURATION_STORAGE = 'timetable.focus.duration.v1'
const BREAK_SECONDS = 5 * 60

function readTimerStore(): TimerStore {
  try {
    const value = JSON.parse(localStorage.getItem(TIMER_STORAGE) ?? 'null') as TimerStore | null
    if (value && Array.isArray(value.paused)) return value
  } catch {
    // Ignore old or malformed local timer state.
  }
  return { active: null, paused: [] }
}

function readFocusMinutes(): number {
  try {
    const value = Number(localStorage.getItem(DURATION_STORAGE))
    return [15, 25, 45].includes(value) ? value : 25
  } catch {
    return 25
  }
}

function remainingFor(record: TimerRecord, now: number): number {
  if (!record.running || record.endsAt === null) return record.remainingSeconds
  return Math.max(0, Math.ceil((record.endsAt - now) / 1000))
}

function clockLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function courseTime(course: Course, periods: { periodNumber: number; startTime: string; endTime: string }[]) {
  const start = periods.find((period) => period.periodNumber === course.startPeriod)?.startTime
  const end = periods.find((period) => period.periodNumber === course.endPeriod)?.endTime
  if (!start || !end) return `第 ${course.startPeriod}–${course.endPeriod} 节`
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`
}

export default function FocusPage() {
  const navigate = useNavigate()
  const {
    activeSchedule,
    activeScheduleId,
    courses,
    exams,
    periods,
    todos,
    refreshTodos,
  } = useApp()
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs())
  const [completedCourseIds, setCompletedCourseIds] = useState<Set<number>>(() => new Set())
  const [timerStore, setTimerStore] = useState<TimerStore>(readTimerStore)
  const [focusMinutes, setFocusMinutes] = useState<number>(readFocusMinutes)
  const [now, setNow] = useState(() => Date.now())
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<{ title: string; ddl: Dayjs }>()

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(TIMER_STORAGE, JSON.stringify(timerStore))
    } catch {
      // Timer remains usable for this page session when storage is unavailable.
    }
  }, [timerStore])

  useEffect(() => {
    try {
      localStorage.setItem(DURATION_STORAGE, String(focusMinutes))
    } catch {
      // Keep the selected duration in memory if storage is unavailable.
    }
  }, [focusMinutes])

  useEffect(() => {
    let current = true
    if (activeScheduleId === null) {
      setCompletedCourseIds(new Set())
      return () => {
        current = false
      }
    }
    setCompletedCourseIds(new Set())
    focusApi
      .completedCourseIds(activeScheduleId, selectedDate.format('YYYY-MM-DD'))
      .then((ids) => {
        if (current) setCompletedCourseIds(new Set(ids))
      })
      .catch((error: unknown) => {
        if (current) message.error(error instanceof Error ? error.message : '课程状态读取失败')
      })
    return () => {
      current = false
    }
  }, [activeScheduleId, selectedDate])

  const activeTimer = timerStore.active
  const activeRemaining = activeTimer ? remainingFor(activeTimer, now) : 0

  useEffect(() => {
    if (!activeTimer?.running || activeTimer.endsAt === null || now < activeTimer.endsAt) return
    setTimerStore((current) => {
      if (current.active?.target.key !== activeTimer.target.key || !current.active.running) return current
      return {
        ...current,
        active: { ...current.active, running: false, endsAt: null, remainingSeconds: 0 },
      }
    })
    if (activeTimer.phase === 'focus') message.success('本轮专注结束了，休息一下或继续处理任务吧。')
    else message.info('休息结束，可以开始下一轮专注。')
  }, [activeTimer, now])

  const agenda = useMemo(
    () => activeSchedule ? dayAgenda(selectedDate.format('YYYY-MM-DD'), activeSchedule, courses, exams) : null,
    [activeSchedule, courses, exams, selectedDate],
  )
  const classTasks = agenda?.courses ?? []
  const timeline = useMemo(() => {
    if (!agenda) return []
    const courseEntries = agenda.courses.map((course) => ({
      key: `course:${course.id}`,
      kind: 'course' as const,
      title: course.name,
      location: course.location,
      startTime: periods.find((period) => period.periodNumber === course.startPeriod)?.startTime ?? null,
      endTime: periods.find((period) => period.periodNumber === course.endPeriod)?.endTime ?? null,
      course,
    }))
    const examEntries = agenda.exams.map((exam) => ({
      key: `exam:${exam.id}`,
      kind: 'exam' as const,
      title: exam.name,
      location: exam.location,
      startTime: exam.startTime,
      endTime: exam.endTime,
      exam,
    }))
    return [...courseEntries, ...examEntries].sort((a, b) =>
      (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.key.localeCompare(b.key),
    )
  }, [agenda, periods])
  const nextArrangement = useMemo(() => {
    const selectedDay = selectedDate.format('YYYY-MM-DD')
    const today = dayjs(now).format('YYYY-MM-DD')
    if (selectedDay < today) return null
    return timeline.find((item) => {
      if (item.kind === 'course' && completedCourseIds.has(item.course.id)) return false
      if (!item.startTime || !item.endTime) return false
      return selectedDay > today || dayjs(`${selectedDay}T${item.endTime}`).valueOf() > now
    }) ?? null
  }, [timeline, selectedDate, now, completedCourseIds])

  const openTodos = useMemo(
    () => [...todos].filter((todo) => !todo.completed).sort((a, b) => dayjs(a.ddl).valueOf() - dayjs(b.ddl).valueOf()),
    [todos],
  )
  const completedTodos = useMemo(
    () => [...todos].filter((todo) => todo.completed).sort((a, b) => dayjs(b.updatedAt ?? b.ddl).valueOf() - dayjs(a.updatedAt ?? a.ddl).valueOf()),
    [todos],
  )

  const beginFocus = (target: FocusTarget) => {
    const current = timerStore
    const nowValue = Date.now()
    if (current.active?.target.key === target.key) {
      const remainingSeconds = remainingFor(current.active, nowValue)
      if (remainingSeconds > 0) {
        setTimerStore({
          ...current,
          active: {
            ...current.active,
            remainingSeconds,
            endsAt: nowValue + remainingSeconds * 1000,
            running: true,
          },
        })
        return
      }
    }

    const paused = current.paused.filter((record) => record.target.key !== current.active?.target.key)
    if (current.active && current.active.target.key !== target.key) {
      const remainingSeconds = remainingFor(current.active, nowValue)
      if (remainingSeconds > 0) {
        paused.push({ ...current.active, running: false, endsAt: null, remainingSeconds })
        message.info(`已暂停「${current.active.target.title}」，可以稍后继续。`)
      }
    }

    const pausedIndex = paused.findIndex((record) => record.target.key === target.key)
    if (pausedIndex >= 0) {
      const [resume] = paused.splice(pausedIndex, 1)
      if (resume.remainingSeconds > 0) {
        setTimerStore({
          active: { ...resume, running: true, endsAt: nowValue + resume.remainingSeconds * 1000 },
          paused,
        })
        return
      }
    }

    setTimerStore({
      active: {
        target,
        phase: 'focus',
        focusMinutes,
        remainingSeconds: focusMinutes * 60,
        endsAt: nowValue + focusMinutes * 60 * 1000,
        running: true,
      },
      paused,
    })
  }

  const pauseTimer = () => {
    setTimerStore((current) => {
      if (!current.active) return current
      return {
        ...current,
        active: {
          ...current.active,
          running: false,
          endsAt: null,
          remainingSeconds: remainingFor(current.active, Date.now()),
        },
      }
    })
  }

  const resumeTimer = () => {
    setTimerStore((current) => {
      if (!current.active || current.active.remainingSeconds <= 0) return current
      return {
        ...current,
        active: {
          ...current.active,
          running: true,
          endsAt: Date.now() + current.active.remainingSeconds * 1000,
        },
      }
    })
  }

  const startBreak = () => {
    setTimerStore((current) => {
      if (!current.active) return current
      return {
        ...current,
        active: {
          ...current.active,
          phase: 'break',
          remainingSeconds: BREAK_SECONDS,
          endsAt: Date.now() + BREAK_SECONDS * 1000,
          running: true,
        },
      }
    })
  }

  const continueFocus = () => {
    setTimerStore((current) => {
      if (!current.active) return current
      const seconds = current.active.focusMinutes * 60
      return {
        ...current,
        active: {
          ...current.active,
          phase: 'focus',
          remainingSeconds: seconds,
          endsAt: Date.now() + seconds * 1000,
          running: true,
        },
      }
    })
  }

  const clearTimerFor = (key: string) => {
    setTimerStore((current) => ({
      active: current.active?.target.key === key ? null : current.active,
      paused: current.paused.filter((record) => record.target.key !== key),
    }))
  }

  const toggleCourse = async (course: Course) => {
    if (activeScheduleId === null) return
    const date = selectedDate.format('YYYY-MM-DD')
    const completed = !completedCourseIds.has(course.id)
    try {
      await focusApi.setCourseCompleted(course.id, { scheduleId: activeScheduleId, date, completed })
      setCompletedCourseIds((current) => {
        const next = new Set(current)
        if (completed) next.add(course.id)
        else next.delete(course.id)
        return next
      })
      if (completed) {
        clearTimerFor(`course:${date}:${course.id}`)
        message.success('完成一项课程安排，做得不错！')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '课程状态更新失败')
    }
  }

  const toggleTodo = async (todo: Todo) => {
    try {
      await todoApi.toggle(todo.id)
      clearTimerFor(`todo:${todo.id}`)
      await refreshTodos()
      if (!todo.completed) message.success('又完成了一项，做得不错！')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务状态更新失败')
    }
  }

  const openAdd = () => {
    form.resetFields()
    form.setFieldsValue({ ddl: selectedDate.hour(23).minute(59).second(0) })
    setAddOpen(true)
  }

  const createTodo = async () => {
    let values: { title: string; ddl: Dayjs }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await todoApi.create({
        title: values.title.trim(),
        ddl: values.ddl.format('YYYY-MM-DDTHH:mm:ss'),
      })
      await refreshTodos()
      setAddOpen(false)
      message.success('临时任务已加入清单。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务添加失败')
    } finally {
      setSaving(false)
    }
  }

  const completedCourseCount = classTasks.filter((course) => completedCourseIds.has(course.id)).length
  const overdueTodoCount = openTodos.filter((todo) => dayjs(todo.ddl).isBefore(dayjs(now))).length
  const dueTodayCount = openTodos.filter((todo) => dayjs(todo.ddl).isSame(selectedDate, 'day')).length
  const nextIsRunning = nextArrangement?.startTime
    ? selectedDate.isSame(dayjs(now), 'day') && dayjs(`${selectedDate.format('YYYY-MM-DD')}T${nextArrangement.startTime}`).valueOf() <= now
    : false
  const selectedDateLabel = selectedDate.format('YYYY年M月D日')
  const activeDuration = activeTimer?.phase === 'break' ? BREAK_SECONDS : (activeTimer?.focusMinutes ?? focusMinutes) * 60
  const timerPercent = activeTimer ? Math.min(100, Math.round((1 - activeRemaining / activeDuration) * 100)) : 0

  return (
    <div className="focus-page daily-today-page">
      <div className="page-header focus-page-header daily-page-header">
        <div className="daily-page-heading">
          <Typography.Title level={2} style={{ margin: 0 }}>今日</Typography.Title>
          <Typography.Text type="secondary">{activeSchedule?.name ?? '选择课表后查看课程与考试'} · 先安排，再专注</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<RobotOutlined />} onClick={() => navigate('/ai')}>规划一天</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>临时任务</Button>
        </Space>
      </div>

      <div className="focus-date-row">
        <Space>
          <Button aria-label="前一天" icon={<LeftOutlined />} onClick={() => setSelectedDate((date) => date.subtract(1, 'day'))} />
          <DatePicker value={selectedDate} onChange={(date) => date && setSelectedDate(date)} allowClear={false} />
          <Button aria-label="后一天" icon={<RightOutlined />} onClick={() => setSelectedDate((date) => date.add(1, 'day'))} />
          <Button onClick={() => setSelectedDate(dayjs())}>今天</Button>
        </Space>
        <Typography.Text type="secondary">{selectedDateLabel}</Typography.Text>
      </div>

      <section className="today-next-arrangement" aria-label="下一项安排">
        <div className="today-next-copy">
          <div className="daily-eyebrow">{nextIsRunning ? '正在进行' : selectedDate.isSame(dayjs(now), 'day') ? '下一项安排' : '所选日期安排'}</div>
          <Typography.Title level={3} style={{ margin: '6px 0' }}>
            {nextArrangement?.title ?? (timeline.some((item) => !item.startTime || !item.endTime)
              ? '课程时间待配置'
              : timeline.length ? '这一天的后续安排已结束' : '给这一天留一点自己的时间')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {nextArrangement
              ? `${nextArrangement.kind === 'exam' ? '考试' : '课程'} · ${nextArrangement.startTime?.slice(0, 5)}–${nextArrangement.endTime?.slice(0, 5)} · ${nextArrangement.location || '地点未指定'}`
              : timeline.some((item) => !item.startTime || !item.endTime)
                ? '部分课程未配置作息时间，请在下方时间线查看节次。'
                : '查看下方待办，或选择一项任务开始专注。'}
          </Typography.Text>
        </div>
        <Button onClick={() => navigate('/timetable')}>查看课表</Button>
      </section>

      <div className="focus-layout">
        <div className="focus-task-column">

          <Card title={<Space><CalendarOutlined />当日时间线</Space>} className="focus-list-card" extra={<Typography.Text type="secondary">课程 {completedCourseCount}/{classTasks.length} 已完成</Typography.Text>}>
            {!activeSchedule ? (
              <Empty description="请先创建或选择课表" />
            ) : timeline.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这一天没有课程或考试" />
            ) : (
              <div className="focus-task-list today-timeline">
                {timeline.map((entry) => {
                  if (entry.kind === 'exam') return (
                    <div key={entry.key} className="focus-task-row today-timeline-row is-exam">
                      <div className="today-timeline-time">{entry.startTime?.slice(0, 5)}<span>{entry.endTime?.slice(0, 5)}</span></div>
                      <div className="focus-task-copy">
                        <Typography.Text strong>{entry.title}</Typography.Text>
                        <Space size={[6, 4]} wrap>
                          <Tag icon={<TrophyOutlined />} color="red">考试</Tag>
                          <Typography.Text type="secondary">{entry.location || '地点未指定'}</Typography.Text>
                        </Space>
                      </div>
                      <Button onClick={() => {
                        navigate('/timetable')
                        message.info('请在课表页「更多 → 考试管理」查看或修改考试。')
                      }}>查看考试</Button>
                    </div>
                  )
                  const course = entry.course
                  const completed = completedCourseIds.has(course.id)
                  const target: FocusTarget = {
                    key: `course:${selectedDate.format('YYYY-MM-DD')}:${course.id}`,
                    kind: 'course',
                    id: course.id,
                    title: course.name,
                  }
                  const timerSelected = activeTimer?.target.key === target.key
                  return (
                    <div key={entry.key} className={`focus-task-row today-timeline-row${completed ? ' is-completed' : ''}`}>
                      <div className="today-timeline-time">
                        {entry.startTime?.slice(0, 5) ?? `第${course.startPeriod}节`}
                        <span>{entry.endTime?.slice(0, 5) ?? `至第${course.endPeriod}节`}</span>
                      </div>
                      <div className="focus-task-copy">
                        <Typography.Text strong>{course.name}</Typography.Text>
                        <Space size={[6, 4]} wrap>
                          <Tag color="blue">课程</Tag>
                          <Typography.Text type="secondary">{courseTime(course, periods)}</Typography.Text>
                          {course.location && <Typography.Text type="secondary">{course.location}</Typography.Text>}
                        </Space>
                      </div>
                      {completed ? (
                        <Button icon={<CheckOutlined />} onClick={() => void toggleCourse(course)}>已完成</Button>
                      ) : (
                        <Space wrap>
                          <Button
                            type={timerSelected ? 'primary' : 'default'}
                            icon={<PlayCircleOutlined />}
                            onClick={() => beginFocus(target)}
                          >
                            {timerSelected
                              ? activeTimer?.phase === 'break' ? '继续休息' : '继续专注'
                              : '开始专注'}
                          </Button>
                          <Button type="primary" ghost onClick={() => void toggleCourse(course)}>完成</Button>
                        </Space>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card
            title={<Space><CheckOutlined />待办概要<Tag>{openTodos.length}</Tag></Space>}
            className="focus-list-card"
            extra={<Button type="link" onClick={() => navigate('/tasks?view=all')}>管理全部</Button>}
          >
            <div className="today-todo-summary">
              <span>所选日期截止 <strong>{dueTodayCount}</strong></span>
              {overdueTodoCount > 0 && <span className="daily-danger">已逾期 <strong>{overdueTodoCount}</strong></span>}
            </div>
            {openTodos.length === 0 ? (
              <Empty description="没有待处理任务，享受一下空档吧" />
            ) : (
              <div className="focus-task-list">
                {openTodos.slice(0, 5).map((todo) => {
                  const target: FocusTarget = {
                    key: `todo:${todo.id}`,
                    kind: 'todo',
                    id: todo.id,
                    title: todo.title,
                  }
                  const timerSelected = activeTimer?.target.key === target.key
                  return (
                    <TodoTaskRow
                      key={todo.id}
                      todo={todo}
                      timerSelected={timerSelected}
                      timerPhase={timerSelected ? activeTimer?.phase : undefined}
                      onFocus={() => beginFocus(target)}
                      onComplete={() => void toggleTodo(todo)}
                    />
                  )
                })}
              </div>
            )}
            {openTodos.length > 5 && <Button type="link" onClick={() => navigate('/tasks?view=all')}>查看其余 {openTodos.length - 5} 项待办</Button>}
          </Card>

          {completedTodos.length > 0 && (
            <Card title="已完成" className="focus-list-card focus-completed-card">
              <div className="focus-task-list">
                {completedTodos.slice(0, 5).map((todo) => (
                  <div key={todo.id} className="focus-task-row is-completed">
                    <div className="focus-task-copy">
                      <Typography.Text delete type="secondary">{todo.title}</Typography.Text>
                      <Typography.Text type="secondary">{dayjs(todo.ddl).format('M月D日截止')}</Typography.Text>
                    </div>
                    <Button type="link" onClick={() => void toggleTodo(todo)}>撤销</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="focus-timer-card">
          <div className="focus-timer-heading">
            <Space><FieldTimeOutlined />专注计时</Space>
            <Select
              aria-label="专注时长"
              size="small"
              value={focusMinutes}
              onChange={setFocusMinutes}
              options={[15, 25, 45].map((value) => ({ value, label: `${value} 分钟` }))}
              disabled={Boolean(activeTimer?.running)}
            />
          </div>
          <Progress
            className="focus-timer-progress"
            type="circle"
            percent={timerPercent}
            size={208}
            strokeWidth={6}
            strokeColor={activeTimer?.phase === 'break' ? '#0c7c72' : '#167d9a'}
            format={() => (
              <div className="focus-clock-face">
                <Typography.Text type="secondary">
                  {activeTimer?.phase === 'break' ? '休息中' : activeTimer ? '专注中' : '准备开始'}
                </Typography.Text>
                <Typography.Title level={1} className="focus-clock-time">
                  {activeTimer ? clockLabel(activeRemaining) : clockLabel(focusMinutes * 60)}
                </Typography.Title>
              </div>
            )}
          />
          <Typography.Paragraph className="focus-current-task" ellipsis={{ rows: 2 }}>
            {activeTimer?.target.title ?? '从课程或待办中选择一项任务'}
          </Typography.Paragraph>
          <div className="focus-timer-controls">
            {activeTimer?.running ? (
              <Button size="large" icon={<PauseOutlined />} onClick={pauseTimer}>暂停</Button>
            ) : activeTimer && activeRemaining > 0 ? (
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} onClick={resumeTimer}>继续</Button>
            ) : activeTimer?.phase === 'focus' ? (
              <Space wrap>
                <Button type="primary" size="large" icon={<CoffeeOutlined />} onClick={startBreak}>开始休息</Button>
                <Button size="large" icon={<PlayCircleOutlined />} onClick={continueFocus}>再专注一轮</Button>
              </Space>
            ) : activeTimer?.phase === 'break' ? (
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} onClick={continueFocus}>开始下一轮</Button>
            ) : (
              <Typography.Text type="secondary">选择一项任务后开始</Typography.Text>
            )}
          </div>
          {activeTimer && !activeTimer.running && (
            <Button
              type="link"
              onClick={() => setTimerStore((current) => ({ ...current, active: null }))}
            >
              关闭当前计时
            </Button>
          )}
          {timerStore.paused.length > 0 && (
            <div className="focus-paused-list">
              <Typography.Text type="secondary">已暂停的任务</Typography.Text>
              {timerStore.paused.map((record) => (
                <Button
                  key={record.target.key}
                  type="link"
                  onClick={() => beginFocus(record.target)}
                >
                  {record.target.title} · {clockLabel(record.remainingSeconds)}
                </Button>
              ))}
            </div>
          )}
          <Typography.Text className="focus-timer-hint" type="secondary">
            计时结束不会自动完成任务；请在任务卡片上确认完成。
          </Typography.Text>
        </Card>
      </div>

      <Modal
        title="添加临时任务"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void createTodo()}
        confirmLoading={saving}
        okText="加入清单"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="title" label="任务内容" rules={[{ required: true, whitespace: true, message: '请填写任务内容' }]}>
            <Input maxLength={500} placeholder="例如：复习数据结构第三章" autoFocus />
          </Form.Item>
          <Form.Item name="ddl" label="截止时间" rules={[{ required: true, message: '请选择截止时间' }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function TodoTaskRow({
  todo,
  timerSelected,
  timerPhase,
  onFocus,
  onComplete,
}: {
  todo: Todo
  timerSelected: boolean
  timerPhase?: 'focus' | 'break'
  onFocus: () => void
  onComplete: () => void
}) {
  const overdue = dayjs(todo.ddl).isBefore(dayjs())
  return (
    <div className="focus-task-row">
      <div className="focus-task-copy">
        <Typography.Text strong>{todo.title}</Typography.Text>
        <Space size={[6, 4]} wrap>
          <Tag color={todo.recurringId ? 'blue' : todo.examId ? 'red' : 'default'}>
            {todo.recurringId ? '循环任务' : todo.examId ? '考试' : '临时任务'}
          </Tag>
          <Typography.Text type={overdue ? 'danger' : 'secondary'}>
            <ClockCircleOutlined /> {dayjs(todo.ddl).format('M月D日 HH:mm')} 截止
          </Typography.Text>
        </Space>
      </div>
      <Space wrap>
        <Button type={timerSelected ? 'primary' : 'default'} icon={<PlayCircleOutlined />} onClick={onFocus}>
          {timerSelected ? (timerPhase === 'break' ? '继续休息' : '继续专注') : '开始专注'}
        </Button>
        <Button type="primary" ghost icon={<CheckOutlined />} onClick={onComplete}>完成</Button>
      </Space>
    </div>
  )
}
