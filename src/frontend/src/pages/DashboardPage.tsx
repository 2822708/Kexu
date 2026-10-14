import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Typography,
  message,
} from 'antd'
import {
  CalendarOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  PlusOutlined,
  ReadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { dashboardApi } from '../api'
import TaskCard from '../components/TaskCard'
import { useApp } from '../store/AppContext'
import type { Course, DashboardData, Exam, Task } from '../types'
import { dayjs, formatWeekInfo, weekDayName } from '../utils/schedule'

/**
 * AI Dashboard 首页（AI Campus Agent V1.0 Step 5）。
 *
 * 一次聚合请求渲染：问候 → 今日课程 → 今日任务 → 48h 截止 → 考试倒计时 →
 * 规则今日重点 → AI 建议占位（Step 6 填充）→ 聊天入口。
 * 全部数据来自真实库；今日重点由后端规则计算，不烧 token。
 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const { activeScheduleId, activeSchedule } = useApp()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState<Dayjs>(() => dayjs())

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

  useEffect(() => {
    void load()
  }, [load])

  // 倒计时刷新：任务卡片的「还有 X」需要周期性重渲染（分钟级即可）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(dayjs()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

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

  return (
    <div className="dashboard-page">
      {/* 问候区 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {greeting}，{data?.greetingName ?? '同学'}
            </Typography.Title>
            <Tag icon={<CalendarOutlined />} color="blue">
              {data?.date ?? dayjs().format('YYYY-MM-DD')}
            </Tag>
            {activeSchedule && (
              <Tag>{formatWeekInfo(activeSchedule.periodStartDate, activeSchedule.periodEndDate)}</Tag>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            今天有 {courses.length} 节课、{todayTasks.length} 个待推进任务
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

      <Row gutter={[12, 12]}>
        {/* 今日课程 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={
              <Space>
                <ReadOutlined />
                <span>今日课程</span>
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
                dataSource={courses}
                renderItem={(course) => <CourseItem course={course} />}
              />
            )}
          </Card>
        </Col>

        {/* 今日任务 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={
              <Space>
                <ClockCircleOutlined />
                <span>今日任务</span>
                <Tag color="cyan">{todayTasks.length}</Tag>
              </Space>
            }
            extra={
              <Button
                type="link"
                size="small"
                icon={<MessageOutlined />}
                onClick={() => navigate('/ai')}
              >
                让 AI 安排
              </Button>
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
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {todayTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    now={now}
                    hint={taskHint(task, now)}
                    hintColor={taskHintColor(task, now)}
                  />
                ))}
              </Space>
            )}
          </Card>
        </Col>

        {/* 48 小时内截止 */}
        <Col xs={24} lg={12}>
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
                  <TaskCard key={task.id} task={task} now={now} hint="48 小时内" hintColor="volcano" />
                ))}
              </Space>
            )}
          </Card>
        </Col>

        {/* 考试倒计时 */}
        <Col xs={24} lg={12}>
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
      </Row>

      {/* 今日重点：后端规则计算（逾期/今天截止/48h/考试倒计时），确定性输出 */}
      {highlights.length > 0 && (
        <Card size="small" title="今日重点" style={{ marginTop: 12 }}>
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
      )}

      {/* AI 建议：Step 6 每日计划上线前为占位引导 */}
      <Card size="small" title="AI 学长建议" style={{ marginTop: 12 }}>
        {data?.planSummary ? (
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            {data.planSummary}
          </Typography.Paragraph>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              把课程、任务和截止时间丢给 AI 学长，让它帮你排个优先级；
              也可以直接上传作业通知，自动生成任务草稿。
            </Typography.Text>
            <Space wrap>
              <Button type="primary" icon={<MessageOutlined />} onClick={() => navigate('/ai')}>
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

      {/* 底部聊天入口：首页的核心动作 */}
      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <Button type="primary" size="large" icon={<MessageOutlined />} onClick={() => navigate('/ai')}>
          问 AI 学长：今天我该做什么？
        </Button>
      </div>
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
