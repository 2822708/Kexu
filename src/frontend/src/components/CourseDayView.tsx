import { useMemo } from 'react'
import { Button, DatePicker, Empty, Tag, Typography } from 'antd'
import {
  EditOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import type { Course, Exam, PeriodConfig, Schedule } from '../types'
import { courseClockTime, dayAgenda } from '../utils/dayAgenda'
import { dayjs, weekDayName } from '../utils/schedule'

interface Props {
  date: string
  schedule: Schedule
  courses: Course[]
  exams: Exam[]
  periods: PeriodConfig[]
  onDateChange: (date: string) => void
  onEdit: (course: Course) => void
  onExamClick: () => void
  onCreate: (dayOfWeek?: number) => void
}

export default function CourseDayView({
  date,
  schedule,
  courses,
  exams,
  periods,
  onDateChange,
  onEdit,
  onExamClick,
  onCreate,
}: Props) {
  const agenda = useMemo(
    () => dayAgenda(date, schedule, courses, exams),
    [date, schedule, courses, exams],
  )
  const selected = dayjs(date)
  const today = dayjs().format('YYYY-MM-DD')
  const termLabel =
    agenda.status === 'before-term'
      ? '学期未开始'
      : agenda.status === 'after-term'
        ? '学期已结束'
        : agenda.status === 'invalid'
          ? '学期日期未配置正确'
          : `第 ${agenda.week} 周`
  const emptyDescription =
    agenda.status === 'in-term'
      ? '这天没有课程，安排一点自己的时间吧'
      : agenda.status === 'before-term'
        ? `课程从 ${schedule.periodStartDate} 开始`
        : agenda.status === 'after-term'
          ? `本学期课程已于 ${schedule.periodEndDate} 结束`
          : '请在课表管理中检查学期日期'

  return (
    <section className="day-agenda" aria-label="按日课表">
      <div className="day-agenda-toolbar">
        <Button
          icon={<LeftOutlined />}
          aria-label="上一天"
          onClick={() => onDateChange(selected.subtract(1, 'day').format('YYYY-MM-DD'))}
        />
        <DatePicker
          aria-label="选择课表日期"
          value={selected}
          allowClear={false}
          inputReadOnly
          format="YYYY-MM-DD"
          onChange={(value) => {
            if (value) onDateChange(value.format('YYYY-MM-DD'))
          }}
        />
        <Button
          icon={<RightOutlined />}
          aria-label="下一天"
          onClick={() => onDateChange(selected.add(1, 'day').format('YYYY-MM-DD'))}
        />
        <Button onClick={() => onDateChange(today)} disabled={date === today}>
          今天
        </Button>
      </div>
      <div className="day-agenda-summary">
        <Typography.Title level={4} style={{ margin: 0 }}>
          {selected.format('M月D日')} · {weekDayName(agenda.dayOfWeek ?? 0)}
        </Typography.Title>
        <Tag>{termLabel}</Tag>
        <Typography.Text type="secondary">
          {agenda.courses.length} 门课程 · {agenda.exams.length} 场考试
        </Typography.Text>
      </div>

      {agenda.exams.length > 0 && (
        <section className="day-agenda-section" aria-label="本日考试">
          <Typography.Text strong>
            <TrophyOutlined /> 本日考试
          </Typography.Text>
          {agenda.exams.map((exam) => (
            <article key={exam.id} className="day-agenda-card day-agenda-exam">
              <div className="day-agenda-time">
                <strong>
                  {exam.startTime.slice(0, 5)}–{exam.endTime.slice(0, 5)}
                </strong>
                <span>考试</span>
              </div>
              <div className="day-agenda-copy">
                <div className="day-agenda-card-title">
                  <h3>{exam.name}</h3>
                </div>
                <dl className="day-agenda-details">
                  <div>
                    <dt>地点</dt>
                    <dd>{exam.location || '未指定'}</dd>
                  </div>
                </dl>
              </div>
              <Button
                type="text"
                className="day-agenda-action"
                icon={<EditOutlined />}
                aria-label={`管理考试 ${exam.name}`}
                onClick={onExamClick}
              >
                <span className="day-agenda-action-label">管理考试</span>
              </Button>
            </article>
          ))}
        </section>
      )}

      {agenda.courses.length > 0 ? (
        <section className="day-agenda-section" aria-label="本日课程">
          <Typography.Text strong>本日课程</Typography.Text>
          {agenda.courses.map((course) => {
            const clock = courseClockTime(course, periods)
            return (
              <article key={course.id} className="day-agenda-card">
                <div className="day-agenda-time">
                  <strong>{clock || '作息时间未配置'}</strong>
                  <span>
                    第 {course.startPeriod}–{course.endPeriod} 节
                  </span>
                </div>
                <div className="day-agenda-copy">
                  <div className="day-agenda-card-title">
                    <h3>{course.name}</h3>
                  </div>
                  <dl className="day-agenda-details">
                    <div>
                      <dt>地点</dt>
                      <dd>{course.location || '未指定'}</dd>
                    </div>
                    <div>
                      <dt>教师</dt>
                      <dd>{course.teacher || '未指定'}</dd>
                    </div>
                  </dl>
                </div>
                <Button
                  type="text"
                  className="day-agenda-action"
                  icon={<EditOutlined />}
                  aria-label={`编辑课程 ${course.name}`}
                  onClick={() => onEdit(course)}
                >
                  <span className="day-agenda-action-label">编辑课程</span>
                </Button>
              </article>
            )
          })}
        </section>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription}>
          {agenda.status === 'in-term' && (
            <Button icon={<PlusOutlined />} onClick={() => onCreate(agenda.dayOfWeek ?? undefined)}>
              添加课程
            </Button>
          )}
        </Empty>
      )}
    </section>
  )
}
