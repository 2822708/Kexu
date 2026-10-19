import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, DatePicker, Dropdown, Input, Modal, Spin, message } from 'antd'
import {
  CalendarOutlined,
  CheckOutlined,
  FieldTimeOutlined,
  LeftOutlined,
  MoreOutlined,
  PlusOutlined,
  ReadOutlined,
  RightOutlined,
  StarFilled,
} from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../store/AppContext'
import { useDailyWorkspace } from '../hooks/useDailyWorkspace'
import { dailyApi } from '../local/daily/commands'
import type { DailyResolvedEntry } from '../local/daily/types'
import { nowLocalDateTime } from '../local/domain'
import { validDate } from '../local/validation'
import { dayjs } from '../utils/schedule'
import { dayAgenda } from '../utils/dayAgenda'
import { hasDailyActivity, hasDailyReviewMaterial } from '../local/daily/selectors'
import { dailyReviewStatus, projectDailyReview } from '../local/daily/review'
import DailyReviewSheet from '../components/daily/DailyReviewSheet'
import DailyFocusTimer from '../components/daily/DailyFocusTimer'
import '../daily-task.css'

const todayInShanghai = () => nowLocalDateTime().slice(0, 10)
type Tool = 'schedule' | 'focus' | null
type Undo = { entry: DailyResolvedEntry; eventId?: string; version: number; generation: string }

export default function LocalDailyPage() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { activeSchedule, activeScheduleId, courses, exams, periods } = useApp()
  const [date, setDate] = useState(() =>
    validDate(search.get('date')) ? search.get('date')! : todayInShanghai(),
  )
  const [today, setToday] = useState(todayInShanghai)
  const { workspace, error, refresh } = useDailyWorkspace(date)
  const [filter, setFilter] = useState<'active' | 'completed'>('active')
  const [tool, setTool] = useState<Tool>(null)
  const [title, setTitle] = useState('')
  const [backfill, setBackfill] = useState(false)
  const [editingPast, setEditingPast] = useState(false)
  const [poolOpen, setPoolOpen] = useState(false)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const [reviewDate, setReviewDate] = useState<string | null>(null)
  const reviewSession = useRef<{
    date: string
    generation: string
    version: number
    readOnly: boolean
  } | null>(null)
  const [questionOpen, setQuestionOpen] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const busyRef = useRef(new Set<string>())
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const [effectId, setEffectId] = useState<string | null>(null)
  const completionFocus = useRef<Element | null>(null)
  const [convert, setConvert] = useState<DailyResolvedEntry | null>(null)
  const [ddl, setDdl] = useState<ReturnType<typeof dayjs> | null>(null)
  const inputRef = useRef<import('antd').InputRef>(null)
  const toolRefs = useRef<
    Partial<Record<'schedule' | 'focus' | 'review', HTMLButtonElement | null>>
  >({})
  const drafts = useRef(new Map<string, string>())
  const asked = useRef(new Set<string>())
  const currentScope = useRef({ date, generation: workspace?.generation })
  currentScope.current = { date, generation: workspace?.generation }
  const generation = workspace?.generation
  const previousGeneration = useRef(generation)

  useEffect(() => {
    const interval = window.setInterval(() => setToday(todayInShanghai()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    if (previousGeneration.current && generation && previousGeneration.current !== generation) {
      setReviewDate(null)
      setQuestionOpen(false)
      setConvert(null)
      setUndo(null)
      setEffectId(null)
      reviewSession.current = null
      setPoolOpen(false)
      setPrioritiesOpen(false)
      setNotice('本机数据已恢复，旧操作已关闭。未保存的任务输入已保留，请确认后再保存。')
    }
    if (generation) previousGeneration.current = generation
  }, [generation])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => {
      setNotice('')
      setUndo(null)
    }, 6000)
    return () => window.clearTimeout(timeout)
  }, [notice])
  useEffect(() => {
    if (!effectId) return
    const timeout = window.setTimeout(() => {
      setEffectId(null)
      if (
        document.activeElement === completionFocus.current ||
        document.activeElement === document.body
      )
        inputRef.current?.focus({ preventScroll: true })
    }, 460)
    return () => window.clearTimeout(timeout)
  }, [effectId])

  const isPast = date < today
  const isFuture = date > today
  const canEdit = !isPast || editingPast
  const entries = workspace?.entries ?? []
  const active = entries.filter((item) => !item.completed)
  const done = entries.filter((item) => item.completed)
  const visible = entries.filter((item) =>
    filter === 'active' ? !item.completed || effectId === item.publicId : item.completed,
  )
  const reviewState = workspace?.state
  const reviewFacts = reviewState && reviewDate ? projectDailyReview(reviewState, reviewDate) : null
  const yesterday = dayjs(today).subtract(1, 'day').format('YYYY-MM-DD')
  const yesterdayAvailable = reviewState ? hasDailyReviewMaterial(reviewState, yesterday) : false
  const review = reviewState?.dailyReviews.find((item) => item.date === reviewDate)
  const reviewStatus = reviewState ? dailyReviewStatus(reviewState, date) : ''
  const agenda = useMemo(
    () => (activeSchedule ? dayAgenda(date, activeSchedule, courses, exams) : null),
    [activeSchedule, courses, exams, date],
  )
  const context = () => {
    if (!workspace) throw new Error('日任务仍在加载，请稍后重试')
    return {
      expectedGeneration: workspace.generation,
      operationId: crypto.randomUUID(),
      allowPast: editingPast,
    }
  }
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busyRef.current.has(key)) return
    busyRef.current.add(key)
    setBusy(new Set(busyRef.current))
    try {
      await action()
    } catch (err) {
      const text = err instanceof Error ? err.message : '操作未能保存，请重试'
      setNotice(text)
      message.error(text)
      setUndo(null)
    } finally {
      busyRef.current.delete(key)
      setBusy(new Set(busyRef.current))
    }
  }
  const changeDate = (next: string) => {
    drafts.current.set(date, title)
    setDate(next)
    setBackfill(false)
    setTitle(drafts.current.get(next) ?? '')
    setEditingPast(false)
    setEffectId(null)
    setTool(null)
    setUndo(null)
    setNotice('')
    setReviewDate(null)
  }
  const completed = async (entry: DailyResolvedEntry) => {
    const originalFocus = document.activeElement
    const expectedDate = date
    const ctx = context()
    const result = await dailyApi.setCompleted({
      ...ctx,
      entryPublicId: entry.publicId,
      expectedVersion: entry.version,
      completed: !entry.completed,
    })
    const next = await refresh()
    if (
      currentScope.current.date !== expectedDate ||
      currentScope.current.generation !== ctx.expectedGeneration
    )
      return
    if (!result.changed) return
    if (!entry.completed) {
      const updated = next.entries.find((item) => item.publicId === entry.publicId)
      setNotice(`已完成：${entry.title}`)
      setUndo(
        updated
          ? {
              entry: updated,
              version: updated.version,
              eventId: result.completionEventId,
              generation: ctx.expectedGeneration,
            }
          : null,
      )
      if (date === today) {
        completionFocus.current = originalFocus
        setEffectId(entry.publicId)
      }
    } else {
      setNotice(`已恢复待做：${entry.title}`)
      setUndo(null)
      requestAnimationFrame(() => {
        if (document.activeElement === originalFocus || document.activeElement === document.body)
          inputRef.current?.focus({ preventScroll: true })
      })
    }
  }
  const submitQuick = () =>
    void run('create', async () => {
      const value = title.trim()
      if (!value || !canEdit) return
      const selected = date
      const ctx = context()
      const result = await dailyApi.createTask({ ...ctx, date, title: value, completed: backfill })
      await refresh()
      if (
        currentScope.current.generation === ctx.expectedGeneration &&
        drafts.current.get(selected)?.trim() === value
      )
        drafts.current.delete(selected)
      if (
        currentScope.current.date !== selected ||
        currentScope.current.generation !== ctx.expectedGeneration
      )
        return
      setTitle('')
      drafts.current.delete(selected)
      setNotice(backfill ? `这件事也记下了：${value}` : `已加入：${value}`)
      if (backfill && selected === today && result.changed) setEffectId('composer')
      inputRef.current?.focus({ preventScroll: true })
    })
  const openReview = () => {
    setTool(null)
    setReviewError('')
    if (!reviewState || isFuture) return
    const key = `${reviewState.datasetId}:${today}`
    let prompted = asked.current.has(key)
    try {
      prompted ||= localStorage.getItem(`tangent.daily.review.asked:${key}`) === 'yes'
    } catch {
      /* Preference only. */
    }
    if (
      date === today &&
      !hasDailyActivity(reviewState, today) &&
      yesterdayAvailable &&
      !prompted
    ) {
      asked.current.add(key)
      try {
        localStorage.setItem(`tangent.daily.review.asked:${key}`, 'yes')
      } catch {
        /* Session marker remains. */
      }
      setQuestionOpen(true)
    } else openReviewDate(date)
  }
  const openReviewDate = (value: string) => {
    if (!workspace) return
    reviewSession.current = {
      date: value,
      generation: workspace.generation,
      version: workspace.state.dailyReviews.find((item) => item.date === value)?.version ?? 0,
      readOnly: value !== todayInShanghai(),
    }
    setReviewDate(value)
  }
  const reviewContext = () => {
    const session = reviewSession.current
    if (!session) throw new Error('请重新打开回顾')
    return {
      expectedGeneration: session.generation,
      operationId: crypto.randomUUID(),
      date: session.date,
      expectedVersion: session.version,
      allowPast: !session.readOnly,
    }
  }
  const advanceReview = (submitted: ReturnType<typeof reviewContext>) => {
    const session = reviewSession.current
    if (
      session &&
      session.date === submitted.date &&
      session.generation === submitted.expectedGeneration &&
      session.version === submitted.expectedVersion
    )
      session.version = submitted.expectedVersion + 1
  }
  const closeReview = () => {
    setReviewDate(null)
    reviewSession.current = null
    requestAnimationFrame(() => toolRefs.current.review?.focus())
  }
  const focusTargets = active
    .filter((item) => !item.missingSource && !item.examLinked)
    .map((item) => ({ key: item.publicId, title: item.title }))

  if (!workspace)
    return (
      <div className="daily-workspace-loading">
        {error ? (
          <Alert
            type="error"
            message={error}
            action={<Button onClick={() => void refresh()}>重试</Button>}
          />
        ) : (
          <Spin tip="正在读取日任务">
            <div style={{ height: 80 }} />
          </Spin>
        )}
      </div>
    )

  return (
    <div className="daily-workspace">
      <header className="daily-heading">
        <h1>
          <span className="daily-brand" aria-hidden="true">
            ◩
          </span>
          {isPast ? '回顾' : isFuture ? '计划' : '今日'}
        </h1>
        <div className="daily-date-control">
          <Button
            aria-label="前一天"
            icon={<LeftOutlined />}
            onClick={() => changeDate(dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'))}
          />
          <DatePicker
            aria-label="计划日期"
            value={dayjs(date)}
            allowClear={false}
            inputReadOnly
            onChange={(value) => value && changeDate(value.format('YYYY-MM-DD'))}
          />
          <Button
            aria-label="后一天"
            icon={<RightOutlined />}
            onClick={() => changeDate(dayjs(date).add(1, 'day').format('YYYY-MM-DD'))}
          />
        </div>
      </header>
      {date !== today && (
        <div className="daily-date-note">
          <Button type="link" onClick={() => changeDate(today)}>
            回到今天
          </Button>
          {isPast && (
            <Button type="link" onClick={() => setEditingPast((value) => !value)}>
              {editingPast ? '结束历史编辑' : '更正 / 补记这一天'}
            </Button>
          )}
        </div>
      )}
      {date !== today && date === dayjs(today).subtract(1, 'day').format('YYYY-MM-DD') && (
        <p className="daily-muted">新的一天已开始，未完成事项仍保留在原日期。</p>
      )}
      {error && <Alert type="error" message={error} />}
      <section className="daily-main" aria-label="日任务">
        <div className="daily-list-toolbar">
          <div className="daily-list-tabs" role="tablist" aria-label="日任务状态">
            <button
              role="tab"
              aria-selected={filter === 'active'}
              onClick={() => setFilter('active')}
            >
              待做 <span>{active.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={filter === 'completed'}
              onClick={() => setFilter('completed')}
            >
              已完成 <span>{done.length}</span>
            </button>
          </div>
          <div className="daily-list-tools">
            <Button type="text" onClick={() => setPrioritiesOpen(true)} disabled={!canEdit}>
              重点
            </Button>
            <Button
              type="text"
              icon={<PlusOutlined />}
              aria-label="添加日任务"
              onClick={() => inputRef.current?.focus()}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div
          className="daily-entry-list"
          role="tabpanel"
          aria-label={filter === 'active' ? '待做任务' : '已完成任务'}
        >
          {visible.length === 0 && (
            <div className="daily-empty">
              {filter === 'completed' ? '还没有已完成的日任务' : '把想做的事记在这里'}
              <p>可以快速记录一件事，或从待办中选入。</p>
            </div>
          )}
          {visible.map((entry) => (
            <article
              key={entry.publicId}
              className={`daily-entry${entry.isPriority ? ' is-priority' : ''}${entry.completed ? ' is-completed' : ''}${effectId === entry.publicId ? ' is-celebrating' : ''}`}
            >
              <div className="daily-check-wrap">
                <button
                  className="daily-check"
                  aria-label={`${entry.completed ? '恢复待做' : '完成'} ${entry.title}`}
                  aria-pressed={entry.completed}
                  disabled={
                    !canEdit ||
                    isFuture ||
                    entry.missingSource ||
                    entry.examLinked ||
                    busy.has(entry.publicId)
                  }
                  onClick={() => void run(entry.publicId, () => completed(entry))}
                >
                  {busy.has(entry.publicId) ? (
                    <Spin size="small" />
                  ) : entry.completed ? (
                    <CheckOutlined />
                  ) : (
                    <span className="daily-empty-check" />
                  )}
                </button>
                {effectId === entry.publicId && (
                  <span className="daily-completion-effect" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <div className="daily-entry-copy">
                <div className="daily-entry-title">
                  {entry.isPriority && (
                    <StarFilled className="daily-priority-star" aria-label="重点" />
                  )}
                  {entry.title}
                </div>
                <div className="daily-entry-meta">
                  {entry.origin === 'backfill' ? (
                    <span>补记</span>
                  ) : entry.kind === 'dayTask' && entry.origin === 'adHoc' ? (
                    <span>临时</span>
                  ) : null}
                  {entry.ddl && <span>截止 {dayjs(entry.ddl).format('M月D日 HH:mm')}</span>}
                  {entry.missingSource && <span>原待办已删除 · 保留记录</span>}
                  {entry.examLinked && <span>考试状态随安排更新</span>}
                  {entry.completed && !entry.completedDate && <span>历史完成，日期未记录</span>}
                </div>
              </div>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'priority',
                      label: entry.isPriority ? '取消重点' : '设为重点',
                      disabled: !canEdit,
                    },
                    {
                      key: 'tomorrow',
                      label: '安排到下一天',
                      disabled: !canEdit || entry.completed,
                    },
                    {
                      key: 'convert',
                      label: '转为长期待办',
                      disabled: !canEdit || entry.kind !== 'dayTask' || entry.completed,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'convert') {
                      setConvert(entry)
                      setDdl(null)
                      return
                    }
                    void run(entry.publicId, async () => {
                      if (key === 'priority')
                        await dailyApi.setPriority({
                          ...context(),
                          entryPublicId: entry.publicId,
                          expectedVersion: entry.version,
                          isPriority: !entry.isPriority,
                        })
                      if (key === 'tomorrow') {
                        await dailyApi.moveEntry({
                          ...context(),
                          entryPublicId: entry.publicId,
                          expectedVersion: entry.version,
                          date: dayjs(date).add(1, 'day').format('YYYY-MM-DD'),
                        })
                        setNotice('已安排到下一天，原截止时间保持不变。')
                      }
                      await refresh()
                    })
                  },
                }}
              >
                <Button
                  type="text"
                  className="daily-more"
                  aria-label={`更多操作 ${entry.title}`}
                  icon={<MoreOutlined />}
                />
              </Dropdown>
            </article>
          ))}
        </div>
        {canEdit && (
          <div
            className={`daily-quick-composer${effectId === 'composer' ? ' is-celebrating' : ''}`}
          >
            <div className="daily-composer-modes">
              <button aria-pressed={!backfill} onClick={() => setBackfill(false)}>
                待会要做
              </button>
              <button disabled={isFuture} aria-pressed={backfill} onClick={() => setBackfill(true)}>
                刚刚做完
              </button>
              <button onClick={() => setPoolOpen(true)}>从待办选入</button>
            </div>
            <form
              className="daily-quick-form"
              onSubmit={(event) => {
                event.preventDefault()
                submitQuick()
              }}
            >
              <Input
                ref={inputRef}
                aria-label="快速记录任务"
                placeholder={backfill ? '记下一件已经做完的事' : '记下一件要做的事…'}
                value={title}
                disabled={busy.has('create')}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (event.nativeEvent.isComposing || event.keyCode === 229)
                  )
                    event.preventDefault()
                }}
              />
              <Button
                htmlType="submit"
                type="primary"
                aria-label="保存日任务"
                icon={<PlusOutlined />}
                disabled={!title.trim()}
                loading={busy.has('create')}
              />
            </form>
            {entries.some((entry) => entry.title === title.trim()) && title.trim() && (
              <p className="daily-muted">清单里已有同名事项，仍可继续创建。</p>
            )}
          </div>
        )}
      </section>
      <div className="daily-feedback" role="status" aria-live="polite">
        {notice}
        {undo && (
          <Button
            type="link"
            onClick={() =>
              void run(undo.entry.publicId, async () => {
                await dailyApi.setCompleted({
                  ...context(),
                  expectedGeneration: undo.generation,
                  entryPublicId: undo.entry.publicId,
                  expectedVersion: undo.version,
                  completed: false,
                  undoOf: undo.eventId,
                })
                await refresh()
                setUndo(null)
                setNotice('已撤销，任务恢复待做。')
              })
            }
          >
            撤销
          </Button>
        )}
      </div>
      <section
        className="daily-tools"
        aria-label="日常工具"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && tool) {
            event.preventDefault()
            const previous = tool
            setTool(null)
            toolRefs.current[previous]?.focus()
          }
        }}
      >
        <div className="daily-tool-row">
          <button
            ref={(node) => {
              toolRefs.current.schedule = node
            }}
            aria-expanded={tool === 'schedule'}
            aria-controls="daily-schedule-panel"
            onClick={() => setTool(tool === 'schedule' ? null : 'schedule')}
          >
            <CalendarOutlined />
            日程
          </button>
          <button
            ref={(node) => {
              toolRefs.current.focus = node
            }}
            aria-expanded={tool === 'focus'}
            aria-controls="daily-focus-panel"
            onClick={() => setTool(tool === 'focus' ? null : 'focus')}
          >
            <FieldTimeOutlined />
            专注
          </button>
          <button
            ref={(node) => {
              toolRefs.current.review = node
            }}
            aria-haspopup="dialog"
            disabled={isFuture}
            onClick={openReview}
          >
            <ReadOutlined />
            {date === today ? '今日回顾' : '当日回顾'}
          </button>
        </div>
        {reviewStatus && <p className="daily-review-status">{reviewStatus}</p>}
        <div
          id="daily-schedule-panel"
          hidden={tool !== 'schedule'}
          role="region"
          aria-label="当日日程"
          className="daily-tool-panel"
        >
          <div className="daily-tool-panel-heading">
            <span>{activeSchedule?.name ?? '尚未选择课表'}</span>
            <Button type="link" onClick={() => navigate('/timetable')}>
              查看课表
            </Button>
          </div>
          {(!agenda || (!agenda.courses.length && !agenda.exams.length)) && (
            <p className="daily-muted">这一天没有课程或考试。</p>
          )}
          {agenda?.courses.map((course) => {
            const attended = workspace.state.focusCompletions.some(
              (item) => item.courseId === course.id && item.date === date && item.completed,
            )
            return (
              <div className="daily-agenda-row" key={`course:${course.id}`}>
                <time>
                  {periods
                    .find((period) => period.periodNumber === course.startPeriod)
                    ?.startTime.slice(0, 5) ?? `第${course.startPeriod}节`}
                </time>
                <div>
                  <strong>{course.name}</strong>
                  <p>{course.location}</p>
                </div>
                <Button
                  disabled={!canEdit || isFuture || busy.has(`course:${course.id}`)}
                  onClick={() =>
                    void run(`course:${course.id}`, async () => {
                      if (activeScheduleId === null) return
                      await dailyApi.confirmCourseAttendance({
                        ...context(),
                        courseId: course.id,
                        scheduleId: activeScheduleId,
                        date,
                        completed: !attended,
                      })
                      await refresh()
                    })
                  }
                >
                  {attended ? '恢复待确认' : '确认参加'}
                </Button>
              </div>
            )
          })}
          {agenda?.exams.map((exam) => (
            <div className="daily-agenda-row" key={`exam:${exam.id}`}>
              <time>{exam.startTime.slice(0, 5)}</time>
              <div>
                <strong>{exam.name}</strong>
                <p>
                  考试 · {exam.location || '地点未指定'} · 至{exam.endTime.slice(0, 5)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div
          id="daily-focus-panel"
          hidden={tool !== 'focus'}
          role="region"
          aria-label="专注工具"
          className="daily-tool-panel"
        >
          <DailyFocusTimer
            key={workspace.generation}
            generation={workspace.generation}
            targets={date === today ? focusTargets : []}
            onStart={async () => {
              await dailyApi.markActivity({ ...context(), date: todayInShanghai() })
              await refresh()
            }}
          />
        </div>
      </section>
      <Modal
        title="选入日计划"
        open={poolOpen}
        footer={<Button onClick={() => setPoolOpen(false)}>完成</Button>}
        onCancel={() => setPoolOpen(false)}
      >
        <p className="daily-muted">只建立关联，原截止与完成状态保持一致。</p>
        <div className="daily-pool-list">
          {workspace.candidateTodos.map((todo) => (
            <div key={todo.publicId}>
              <span>
                {todo.title}
                <small>截止 {dayjs(todo.ddl).format('M月D日 HH:mm')}</small>
              </span>
              <Button
                disabled={!canEdit}
                loading={busy.has(todo.publicId)}
                onClick={() =>
                  void run(todo.publicId, async () => {
                    await dailyApi.planTodo({ ...context(), date, todoPublicId: todo.publicId })
                    await refresh()
                  })
                }
              >
                选入
              </Button>
            </div>
          ))}
        </div>
        {workspace.candidateTodos.length === 0 && <p>没有可选入的待办。</p>}
        {workspace.unfinishedEntries.filter((entry) => entry.plannedDate !== date).length > 0 && (
          <>
            <h3>其他日期未处理的日任务</h3>
            <div className="daily-pool-list">
              {workspace.unfinishedEntries
                .filter((entry) => entry.plannedDate !== date)
                .map((entry) => (
                  <div key={entry.publicId}>
                    <span>
                      {entry.title}
                      <small>原计划 {entry.plannedDate}</small>
                    </span>
                    <Button
                      disabled={!canEdit}
                      onClick={() =>
                        void run(entry.publicId, async () => {
                          await dailyApi.moveEntry({
                            ...context(),
                            allowPast: true,
                            entryPublicId: entry.publicId,
                            date,
                            expectedVersion: entry.version,
                          })
                          await refresh()
                        })
                      }
                    >
                      移到这天
                    </Button>
                  </div>
                ))}
            </div>
          </>
        )}
      </Modal>
      <Modal
        title="选择重点 · 最多3项"
        open={prioritiesOpen}
        footer={<Button onClick={() => setPrioritiesOpen(false)}>完成</Button>}
        onCancel={() => setPrioritiesOpen(false)}
      >
        <div className="daily-pool-list">
          {entries.map((entry) => (
            <div key={entry.publicId}>
              <span>{entry.title}</span>
              <Button
                aria-pressed={entry.isPriority}
                disabled={!canEdit}
                loading={busy.has(entry.publicId)}
                onClick={() =>
                  void run(entry.publicId, async () => {
                    await dailyApi.setPriority({
                      ...context(),
                      entryPublicId: entry.publicId,
                      expectedVersion: entry.version,
                      isPriority: !entry.isPriority,
                    })
                    await refresh()
                  })
                }
              >
                {entry.isPriority ? '取消重点' : '设为重点'}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        title="转为长期待办"
        open={Boolean(convert)}
        onCancel={() => setConvert(null)}
        okText="转换"
        cancelText="取消"
        confirmLoading={busy.has('convert')}
        okButtonProps={{ disabled: !ddl }}
        onOk={() =>
          void run('convert', async () => {
            if (!convert || !ddl) return
            await dailyApi.convertToTodo({
              ...context(),
              entryPublicId: convert.publicId,
              expectedVersion: convert.version,
              ddl: ddl.format('YYYY-MM-DDTHH:mm:ss'),
            })
            await refresh()
            setConvert(null)
            setNotice('已转为长期待办，日计划仍保留同一事项。')
          })
        }
      >
        <p>{convert?.title}</p>
        <label>
          截止时间{' '}
          <DatePicker
            aria-label="长期待办截止时间"
            value={ddl}
            onChange={setDdl}
            showTime
            format="YYYY-MM-DD HH:mm"
          />
        </label>
      </Modal>
      <Modal
        title="要先看看昨日回顾吗？"
        open={questionOpen}
        onCancel={() => {
          setQuestionOpen(false)
          toolRefs.current.review?.focus()
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setQuestionOpen(false)
              toolRefs.current.review?.focus()
            }}
          >
            暂不
          </Button>,
          <Button
            key="today"
            onClick={() => {
              setQuestionOpen(false)
              openReviewDate(today)
            }}
          >
            继续今日
          </Button>,
          <Button
            key="yesterday"
            type="primary"
            onClick={() => {
              setQuestionOpen(false)
              openReviewDate(yesterday)
            }}
          >
            查看昨日回顾
          </Button>,
        ]}
      >
        <p>今天还没有新的记录。昨日为 {yesterday}，仅查看，不会改动今日任务。</p>
      </Modal>
      {reviewFacts && reviewDate && (
        <DailyReviewSheet
          open
          date={reviewDate}
          todayDate={today}
          facts={reviewFacts}
          review={review}
          readOnly={reviewSession.current?.readOnly ?? true}
          saving={savingReview}
          error={reviewError}
          onClose={closeReview}
          onSave={async (content, facts) => {
            setSavingReview(true)
            setReviewError('')
            try {
              const submitted = reviewContext()
              await dailyApi.saveReview({ ...submitted, content, facts })
              advanceReview(submitted)
              await refresh()
            } catch (err) {
              const text = err instanceof Error ? err.message : '回顾保存失败'
              setReviewError(text)
              throw err
            } finally {
              setSavingReview(false)
            }
          }}
          onSaveDraft={async (content) => {
            setSavingReview(true)
            setReviewError('')
            try {
              const submitted = reviewContext()
              await dailyApi.saveReviewDraft({ ...submitted, content })
              advanceReview(submitted)
              await refresh()
            } catch (err) {
              const text = err instanceof Error ? err.message : '草稿保存失败'
              setReviewError(text)
              throw err
            } finally {
              setSavingReview(false)
            }
          }}
          onRefreshFacts={async (facts) => {
            if (review?.saved) {
              const submitted = reviewContext()
              await dailyApi.refreshReviewFacts({ ...submitted, facts })
              advanceReview(submitted)
              await refresh()
            }
          }}
          onReturnToday={() => openReviewDate(today)}
          onViewYesterday={
            reviewDate === today && yesterdayAvailable ? () => openReviewDate(yesterday) : undefined
          }
        />
      )}
    </div>
  )
}
