import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  AppstoreOutlined,
  AudioOutlined,
  BulbOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  PlusOutlined,
  ReadOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { dashboardApi, noticeApi, planApi } from '../api'
import { useReminders, REMINDER_COLORS, REMINDER_LABELS } from '../hooks/useReminders'
import DashboardModuleSettings from '../components/DashboardModuleSettings'
import NoticeInboxPanel from '../components/NoticeInboxPanel'
import PlanTimeline from '../components/PlanTimeline'
import TaskCard from '../components/TaskCard'
import { useDashboardModules, type DashboardModuleKey } from '../hooks/useDashboardModules'
import { useApp } from '../store/AppContext'
import { useVoiceAssistant } from '../store/VoiceAssistantContext'
import type { Course, DashboardData, Exam, NoticeCard, Task } from '../types'
import { dayjs, formatWeekInfo, timeOfDay, weekDayName } from '../utils/schedule'
import { groupTasksByUrgency, isAutoEscalated } from '../utils/task'

/**
 * AI Dashboard 首页（AI Campus Agent V1.0 Step 5）+ 分时动态 UI。
 *
 * 一次聚合请求渲染三档布局，**不因为换时段就重新拉数据**——早/午/晚只是同一份
 * 数据的不同呈现权重：早上看今天要做什么，中午看课表，晚上看复盘和明天。
 *
 * 唯一例外是晚间模式的「明日预览」，会额外发一次 dashboard 请求（date=明天）。
 * 那是规则聚合不烧 token，且只在晚上才发。
 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const { activeScheduleId, activeSchedule } = useApp()
  const { openVoiceTask } = useVoiceAssistant()
  const [data, setData] = useState<DashboardData | null>(null)
  const [tomorrow, setTomorrow] = useState<DashboardData | null>(null)
  const [notices, setNotices] = useState<NoticeCard[]>([])
  const [noticeLoading, setNoticeLoading] = useState(true)
  const [noticeError, setNoticeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState<Dayjs>(() => dayjs())
  const [customOpen, setCustomOpen] = useState(false)

  const period = useMemo(() => timeOfDay(now), [now])
  const { reminders, requestNotify, notifyEnabled } = useReminders(
    data?.todayTasks ?? [],
    true,
  )

  /** 首页模块的排序与显隐（用户自定义，存 localStorage） */
  const {
    visible: modules,
    order: moduleOrder,
    hidden: moduleHidden,
    move: moveModule,
    toggle: toggleModule,
    reset: resetModules,
  } = useDashboardModules(period)

  const load = useCallback(async () => {
    try {
      const result = await dashboardApi.get({ scheduleId: activeScheduleId })
      setData(result)
    } catch {
      message.error('首页数据加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [activeScheduleId])

  const loadNotices = useCallback(async () => {
    setNoticeLoading(true)
    setNoticeError(null)
    try {
      setNotices(await noticeApi.list())
    } catch (e) {
      setNotices([])
      setNoticeError(e instanceof Error ? e.message : '通知加载失败')
    } finally {
      setNoticeLoading(false)
    }
  }, [])

  /** 生成当日计划：命中缓存时服务端直接返回，不重复消耗 token */
  const generate = useCallback(async () => {
    setGenerating(true)
    setError('')
    try {
      const plan = await planApi.generate({ scheduleId: activeScheduleId })
      setData((prev) => (prev == null ? prev : { ...prev, plan, planSummary: plan.summary }))
      message.success('今日计划已生成')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成计划失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }, [activeScheduleId])

  useEffect(() => {
    void load()
    void loadNotices()
  }, [load, loadNotices])

  // 倒计时刷新：任务卡片的「还有 X」需要周期性重渲染（分钟级即可）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(dayjs()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /**
   * 明日预览只在晚间模式拉取。
   * 用 ref 记住已拉过的日期，避免 60s 的 now 定时器反复触发请求。
   */
  const tomorrowKey = dayjs().add(1, 'day').format('YYYY-MM-DD')
  const tomorrowLoadedRef = useRef<string>('')
  useEffect(() => {
    if (period !== 'night' || tomorrowLoadedRef.current === tomorrowKey) return
    tomorrowLoadedRef.current = tomorrowKey
    dashboardApi
      .get({ date: tomorrowKey, scheduleId: activeScheduleId })
      .then(setTomorrow)
      .catch(() => setTomorrow(null))
  }, [period, tomorrowKey, activeScheduleId])

  const greeting = useMemo(() => {
    const hour = now.hour()
    if (hour < 6) return '夜深了'
    if (hour < 12) return '早上好'
    if (hour < 14) return '中午好'
    if (hour < 18) return '下午好'
    return '晚上好'
  }, [now])

  if (loading && !data) {
    return (
      <div style={{ padding: 16, maxWidth: 1080, margin: '0 auto' }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  const todayTasks = data?.todayTasks ?? []
  const upcoming = data?.upcomingDeadlines ?? []
  const courses = data?.todayCourses ?? []
  const exams = data?.upcomingExams ?? []
  const highlights = data?.todayHighlights ?? []

  const groups = groupTasksByUrgency(todayTasks, now)
  const doneToday = todayTasks.filter(
    (t) => t.status === 'DONE' || t.status === 'CANCELLED',
  ).length
  const pendingCount = todayTasks.length - doneToday

  /**
   * 下一节课：按节次排序取第一节。
   *
   * 刻意不用 useMemo——它在 early return 之后，包进 Hook 会违反 Hooks 调用顺序规则
   * （lint 的 rules-of-hooks 会直接报错）。这里只是给一个小数组排序，
   * 每次渲染重算的成本可以忽略。
   */
  const nextCourse =
    courses.length === 0
      ? null
      : ([...courses].sort((a, b) => a.startPeriod - b.startPeriod)[0] ?? null)

  /** 最近一个截止事项（48h 窗口优先，其次今日任务） */
  const nearestDeadline: Task | null = upcoming[0] ?? groups.high[0] ?? groups.medium[0] ?? null

  const periodDesc =
    period === 'morning'
      ? '把今天要做的事排个序，先看最要紧的'
      : period === 'day'
        ? '上课时间，只显示当前进度和最近的截止'
        : '今天收个尾，顺便看看明天'

  /**
   * 按用户配置渲染模块。
   *
   * 这里不是 Hook，只是个普通函数——它必须放在 early return 之后（要用到 groups 等
   * 已算好的数据），而 Hook 放在 early return 之后会违反调用顺序规则。
   */
  const renderModule = (key: DashboardModuleKey): ReactNode => {
    switch (key) {
      /* ==================== 今日必做 ==================== */
      case 'tasks':
        return (
          <Col key="tasks" xs={24} lg={14}>
            <Card
              size="small"
              title={
                <Space>
                  <ClockCircleOutlined />
                  <span>今日必做</span>
                  <Tag color="cyan">{todayTasks.length}</Tag>
                </Space>
              }
              extra={
                <Space size={8}>
                  <Tooltip title="按截止时间自动分档：已逾期或今天截止的强制置顶，压过你手动设的优先级">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      按截止分档
                    </Typography.Text>
                  </Tooltip>
                  <Button
                    type="link"
                    size="small"
                    icon={<AudioOutlined />}
                    onClick={openVoiceTask}
                  >
                    语音新增
                  </Button>
                </Space>
              }
              style={{ height: '100%' }}
            >
              {todayTasks.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="今天没有截止任务，可以去待办区看看"
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={10}>
                  {(['high', 'medium', 'low'] as const).map((tier) => {
                    const list = groups[tier]
                    if (list.length === 0) return null
                    return (
                      <div key={tier}>
                        <div style={{ marginBottom: 6 }}>
                          <Tag
                            color={
                              tier === 'high' ? 'red' : tier === 'medium' ? 'orange' : 'default'
                            }
                            style={{ marginInlineEnd: 0 }}
                          >
                            {tier === 'high'
                              ? '高优先级 · 今日截止/强制参与'
                              : tier === 'medium'
                                ? '中优先级 · 建议完成'
                                : '低优先级 · 可灵活延后'}
                          </Tag>
                        </div>
                        <Space direction="vertical" style={{ width: '100%' }} size={8}>
                          {list.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              now={now}
                              hint={
                                isAutoEscalated(task, now)
                                  ? '临近截止自动置顶'
                                  : taskHint(task, now)
                              }
                              hintColor={
                                isAutoEscalated(task, now) ? 'red' : taskHintColor(task, now)
                              }
                            />
                          ))}
                        </Space>
                      </div>
                    )
                  })}
                </Space>
              )}
            </Card>
          </Col>
        )

      /* ==================== 今日课程 ==================== */
      case 'courses':
        return (
          <Col key="courses" xs={24} lg={10}>
            <Card
              size="small"
              title={
                <Space>
                  <ReadOutlined />
                  <span>{period === 'day' ? '今日完整课表' : '今日课程'}</span>
                  <Tag color="geekblue">{courses.length}</Tag>
                </Space>
              }
              extra={
                <Button type="link" size="small" onClick={() => navigate('/timetable')}>
                  查看课表
                </Button>
              }
              style={{ height: '100%' }}
            >
              {courses.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="今天没有课，好好珍惜"
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <List
                  size="small"
                  dataSource={[...courses].sort((a, b) => a.startPeriod - b.startPeriod)}
                  renderItem={(course) => <CourseItem course={course} />}
                />
              )}
            </Card>
          </Col>
        )

      /* ==================== 考试倒计时 ==================== */
      case 'exams':
        return (
          <Col key="exams" xs={24} lg={12}>
            <Card
              size="small"
              title={
                <Space>
                  <CalendarOutlined />
                  <span>考试倒计时</span>
                  <Tag color="red">{exams.length}</Tag>
                </Space>
              }
              style={{ height: '100%' }}
            >
              {exams.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="14 天内没有考试"
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <List
                  size="small"
                  dataSource={exams}
                  renderItem={(exam) => <ExamItem exam={exam} now={now} />}
                />
              )}
            </Card>
          </Col>
        )

      /* ==================== 48 小时内截止 ==================== */
      case 'upcoming':
        return (
          <Col key="upcoming" xs={24} lg={12}>
            <Card
              size="small"
              title={
                <Space>
                  <ExclamationCircleOutlined />
                  <span>48 小时内截止</span>
                  <Tag color="volcano">{upcoming.length}</Tag>
                </Space>
              }
              style={{ height: '100%' }}
            >
              {upcoming.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未来两天没有截止的任务"
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {upcoming.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      now={now}
                      hint="48 小时内"
                      hintColor="volcano"
                    />
                  ))}
                </Space>
              )}
            </Card>
          </Col>
        )

      /* ==================== 今日待阅 ==================== */
      case 'notices':
        return (
          <Col key="notices" xs={24} lg={24}>
            <NoticeInboxPanel
              notices={notices}
              loading={noticeLoading}
              error={noticeError}
              onRefresh={loadNotices}
              compact={period === 'day'}
            />
          </Col>
        )

      /* ==================== 明日课表预览（仅晚间） ==================== */
      case 'tomorrow':
        return (
          <Col key="tomorrow" xs={24} lg={12}>
            <Card
              size="small"
              title={
                <Space>
                  <CalendarOutlined />
                  <span>明日课表预览</span>
                  <Tag color="geekblue">{tomorrow?.todayCourses.length ?? 0}</Tag>
                </Space>
              }
              style={{ height: '100%' }}
            >
              {!tomorrow ? (
                <Skeleton active paragraph={{ rows: 3 }} />
              ) : tomorrow.todayCourses.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="明天没课"
                  style={{ margin: '12px 0' }}
                />
              ) : (
                <List
                  size="small"
                  dataSource={[...tomorrow.todayCourses].sort(
                    (a, b) => a.startPeriod - b.startPeriod,
                  )}
                  renderItem={(course) => <CourseItem course={course} />}
                />
              )}
            </Card>
          </Col>
        )

      /* ==================== 今日重点 ==================== */
      case 'highlights':
        return highlights.length === 0 ? null : (
          <Col key="highlights" xs={24} lg={24}>
            <Card size="small" title="今日重点">
              <List
                size="small"
                dataSource={highlights}
                renderItem={(line) => (
                  <List.Item>
                    <Space>
                      <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />
                      <Typography.Text>{line}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        )

      /* ==================== AI 学长建议 ==================== */
      case 'plan':
        return (
          <Col key="plan" xs={24} lg={24}>
            <Card
              size="small"
              title={
                <Space>
                  <BulbOutlined />
                  <span>{period === 'night' ? '深度内容与建议' : 'AI 学长建议'}</span>
                  {data?.plan?.stale ? (
                    <Tooltip title="生成计划之后，你的课程 / 任务 / 档案又有改动，这条时间线可能不再准确">
                      <Tag color="orange">可能已过时</Tag>
                    </Tooltip>
                  ) : (
                    data?.plan?.cached && <Tag color="green">今日已生成</Tag>
                  )}
                </Space>
              }
              extra={
                data?.plan ? (
                  // 已过时 → 走生成接口真正重算；否则纯刷新（命中缓存，不烧 token）
                  data.plan.stale ? (
                    <Button
                      size="small"
                      type="primary"
                      icon={<BulbOutlined />}
                      loading={generating}
                      onClick={() => void generate()}
                    >
                      重新生成
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={generating}
                      onClick={() => void load()}
                    >
                      刷新
                    </Button>
                  )
                ) : null
              }
            >
              {error && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={error}
                  description="计划由模型生成，偶发不合规会被服务端拦下。稍等几秒重试即可，不会写入无效内容。"
                />
              )}
              {data?.plan?.stale && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="这份计划生成之后，你的课程、任务或档案又改过了"
                  description="旧计划仍然可用，但可能漏掉新加的任务或沿用旧的课程时间。点右上角「重新生成」会按最新数据重排一次（会消耗一次模型调用）。"
                />
              )}
              {data?.plan ? (
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                  <Typography.Paragraph style={{ marginBottom: 0, fontSize: 15 }}>
                    {data.plan.summary}
                  </Typography.Paragraph>
                  <PlanTimeline plan={data.plan} />
                </Space>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Typography.Text type="secondary">
                    让学长把今天的课程、任务和休息排成一条时间线——课程块直接取自课表，
                    任务块只排未完成的那些，全天至少留一段休息。
                  </Typography.Text>
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<BulbOutlined />}
                      loading={generating}
                      onClick={() => void generate()}
                    >
                      生成今日计划
                    </Button>
                    <Button icon={<MessageOutlined />} onClick={() => navigate('/ai')}>
                      去聊天
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={() => navigate('/todos')}>
                      管理待办
                    </Button>
                    <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
                      完善档案
                    </Button>
                  </Space>
                </Space>
              )}
            </Card>
          </Col>
        )

      default:
        return null
    }
  }

  return (
    <div className="dashboard-page" data-period={period}>
      {/* 时段氛围条 */}
      <div className="dashboard-period-bar">
        <Space size={8} wrap>
          <span className="dashboard-period-bar-label">
            {period === 'morning' ? '☀ 早间' : period === 'day' ? '◑ 午间' : '☾ 晚间'}
          </span>
          <span className="dashboard-period-bar-desc">{periodDesc}</span>
        </Space>
        <Space size={6} wrap>
          <Tag icon={<CalendarOutlined />} color="blue">
            {data?.date ?? dayjs().format('YYYY-MM-DD')} {weekDayName(now.isoWeekday())}
          </Tag>
          {activeSchedule && (
            <Tag>{formatWeekInfo(activeSchedule.periodStartDate, activeSchedule.periodEndDate)}</Tag>
          )}
          <Tooltip title="调整首页模块的顺序，或关掉用不上的模块">
            <Button
              size="small"
              type="text"
              icon={<AppstoreOutlined />}
              onClick={() => setCustomOpen(true)}
            >
              自定义
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* 明亮风格 · 今日概览卡（渐变 + 光影 + 完成度进度） */}
      <div className="b-hero" style={{ marginTop: 14 }}>
        <div className="b-hero-title">{greeting}，今天也要顺利度过</div>
        <div className="b-hero-nums">
          <div className="b-hero-cell">
            <div className="v">{courses.length} 节</div>
            <div className="k">今日课程</div>
          </div>
          <div className="b-hero-cell">
            <div className="v">{pendingCount} 项</div>
            <div className="k">待完成任务</div>
          </div>
          <div className="b-hero-cell">
            <div className="v">{nextCourse ? `第 ${nextCourse.startPeriod} 节` : '无课'}</div>
            <div className="k">下节课</div>
          </div>
        </div>
        {todayTasks.length > 0 && (
          <>
            <div className="b-hero-prog-label">
              <span>今日任务完成度</span>
              <span>
                {doneToday} / {todayTasks.length}
              </span>
            </div>
            <div className="b-prog-track">
              <div
                className="b-prog-fill"
                style={{ width: `${Math.round((doneToday / todayTasks.length) * 100)}%` }}
              />
            </div>
          </>
        )}
        <div className="b-hero-next">
          <span className="b-hero-pulse" />
          {nextCourse
            ? `下节 ${nextCourse.name} · 第 ${nextCourse.startPeriod}-${nextCourse.endPeriod} 节${
                nextCourse.location ? ` · ${nextCourse.location}` : ''
              }`
            : '今天的课都结束了，休息一下'}
        </div>
      </div>

      {/* 三级提醒：提前 3 天 / 1 天 / 1 小时。页面关掉就不提醒了，UI 上明说。 */}
      {reminders.length > 0 && (
        <Alert
          type={reminders[0].level === 'imminent' ? 'error' : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space size={6} wrap>
              <span>临近提醒</span>
              {reminders.slice(0, 3).map((reminder) => (
                <Tag
                  key={reminder.task.id}
                  color={REMINDER_COLORS[reminder.level]}
                  style={{ marginInlineEnd: 0 }}
                >
                  {REMINDER_LABELS[reminder.level]}·
                  {reminder.task.title.length > 14
                    ? `${reminder.task.title.slice(0, 14)}…`
                    : reminder.task.title}
                </Tag>
              ))}
            </Space>
          }
          description={
            <Space size={8} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                共 {reminders.length} 项临近截止。提醒只在打开页面时触发，关掉页面不会推送。
              </Typography.Text>
              {!notifyEnabled && (
                <Tooltip title="开启后临近截止会弹系统通知；不开也保留页面内提醒条">
                  <Button size="small" onClick={() => void requestNotify()}>
                    开启系统通知
                  </Button>
                </Tooltip>
              )}
            </Space>
          }
        />
      )}

      {/* 问候区 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {greeting}，{data?.greetingName ?? '同学'}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            今天有 {courses.length} 节课、{pendingCount} 个待推进任务
            {exams.length > 0 && `、${exams.length} 场考试临近`}
            。让 AI 学长帮你把一天安排明白。
          </Typography.Text>
        </Space>
      </Card>

      {/* 未建档引导：档案是五段式上下文的第一段，也是个性化回答的基础 */}
      {data && !data.profilePresent && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="还没有学生档案"
          description="填写专业、目标和学习风格后，AI 学长能给出更贴合你的建议。"
          action={
            <Button size="small" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
              去填写
            </Button>
          }
        />
      )}

      {/* ==================== 午间：今日必做收缩成小条 ==================== */}
      {period === 'day' && (
        <div className="dashboard-mini-bar">
          <span className="mini-label">接下来</span>
          {nextCourse ? (
            <span>
              <Tag color="geekblue" style={{ marginInlineEnd: 4 }}>
                第 {nextCourse.startPeriod}-{nextCourse.endPeriod} 节
              </Tag>
              {nextCourse.name}
              {nextCourse.location ? ` · ${nextCourse.location}` : ''}
            </span>
          ) : (
            <span>今天没有课</span>
          )}
          {nearestDeadline && (
            <>
              <span className="mini-label">最近截止</span>
              <Tooltip title={nearestDeadline.title}>
                <span>
                  <Tag color="volcano" style={{ marginInlineEnd: 4 }}>
                    {nearestDeadline.deadline
                      ? dayjs(nearestDeadline.deadline).format('MM-DD HH:mm')
                      : '无截止'}
                  </Tag>
                  {nearestDeadline.title.length > 18
                    ? `${nearestDeadline.title.slice(0, 18)}…`
                    : nearestDeadline.title}
                </span>
              </Tooltip>
            </>
          )}
          <Button type="link" size="small" onClick={() => navigate('/todos')} style={{ padding: 0 }}>
            查看全部
          </Button>
        </div>
      )}

      {/* ==================== 晚间：完成度复盘 ==================== */}
      {period === 'night' && (
        <Card size="small" title="今日复盘" style={{ marginBottom: 12 }}>
          <div className="dashboard-recap">
            <div>
              <span className="dashboard-recap-num">{doneToday}</span>
              <span className="dashboard-recap-unit">/ {todayTasks.length} 已完成</span>
            </div>
            {pendingCount > 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                还有 {pendingCount} 项没完成，明天会自动出现在「今日必做」，不会凭空消失
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                今天的都清完了，早点休息
              </Typography.Text>
            )}
          </div>
        </Card>
      )}

      <Row gutter={[12, 12]}>
        {modules.map((key) => renderModule(key))}
      </Row>

      {/* 底部聊天入口：首页的核心动作 */}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Button type="primary" size="large" icon={<MessageOutlined />} onClick={() => navigate('/ai')}>
          问 AI 学长：今天我该做什么？
        </Button>
      </div>

      <DashboardModuleSettings
        open={customOpen}
        period={period}
        order={moduleOrder}
        hidden={moduleHidden}
        onMove={moveModule}
        onToggle={toggleModule}
        onReset={resetModules}
        onClose={() => setCustomOpen(false)}
      />
    </div>
  )
}

function CourseItem({ course }: { course: Course }) {
  return (
    <List.Item>
      <List.Item.Meta
        title={
          <Space size={6} wrap>
            <Typography.Text strong>{course.name}</Typography.Text>
            <Tag color="geekblue">
              {weekDayName(course.dayOfWeek)} 第 {course.startPeriod}-{course.endPeriod} 节
            </Tag>
          </Space>
        }
        description={
          [course.location, course.teacher].filter(Boolean).join(' · ') || '地点 / 教师未填写'
        }
      />
    </List.Item>
  )
}

function ExamItem({ exam, now }: { exam: Exam; now: Dayjs }) {
  const days = Math.max(0, dayjs(exam.examDate).startOf('day').diff(now.startOf('day'), 'day'))
  return (
    <List.Item>
      <List.Item.Meta
        title={
          <Space size={6} wrap>
            <Typography.Text strong>{exam.name}</Typography.Text>
            <Tag color="red">还有 {days} 天</Tag>
          </Space>
        }
        description={`${exam.examDate} ${String(exam.startTime).slice(0, 5)}-${String(exam.endTime).slice(0, 5)}${exam.location ? ` · ${exam.location}` : ''}`}
      />
    </List.Item>
  )
}

/** 今日任务 hint：已逾期 / 今天截止 / 无截止（后端已过滤 DONE/CANCELLED） */
function taskHint(task: Task, now: Dayjs): string {
  if (!task.deadline) return '无截止'
  const deadline = dayjs(task.deadline)
  if (deadline.isBefore(now)) return '已逾期'
  if (deadline.isSame(now, 'day')) return '今天截止'
  return '即将截止'
}

function taskHintColor(task: Task, now: Dayjs): string {
  if (!task.deadline) return 'default'
  const deadline = dayjs(task.deadline)
  if (deadline.isBefore(now)) return 'red'
  if (deadline.isSame(now, 'day')) return 'orange'
  return 'blue'
}
