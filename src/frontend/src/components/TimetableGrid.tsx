import { useMemo } from 'react'
import { Empty, Tooltip } from 'antd'
import type { Course, Exam, PeriodConfig } from '../types'
import { courseColor } from '../utils/color'
import { WEEK_DAY_NAMES, dateOfWeekDay, dayjs, formatWeeks } from '../utils/schedule'
import {
  buildTimetableLayout,
  entryGridPosition,
  type TimetableEntry,
} from '../utils/timetableLayout'
import '../timetable-grid.css'

interface Props {
  courses: Course[]
  exams?: Exam[]
  periods: PeriodConfig[]
  week: number
  semesterStart: string | null
  onCourseClick: (course: Course) => void
  onExamClick?: (exam: Exam) => void
  onEmptyClick: (dayOfWeek: number, period: number) => void
}

function entryName(entry: TimetableEntry) {
  return entry.kind === 'course' ? entry.course.name : entry.exam.name
}

export default function TimetableGrid({
  courses,
  exams = [],
  periods,
  week,
  semesterStart,
  onCourseClick,
  onExamClick,
  onEmptyClick,
}: Props) {
  const { periodList, entries, dayLaneCounts, occupied } = useMemo(
    () => buildTimetableLayout({ courses, exams, periods, week, semesterStart }),
    [courses, exams, periods, week, semesterStart],
  )
  const today = dayjs().startOf('day')
  const hasParallelEntries = dayLaneCounts.some((count) => count > 1)
  const dividerRows = new Set(
    periodList.flatMap((period, index) =>
      index < periodList.length - 1 && period.category !== periodList[index + 1].category
        ? [index]
        : [],
    ),
  )

  function renderEntry(entry: TimetableEntry, positioned: boolean) {
    const course = entry.kind === 'course' ? entry.course : null
    const exam = entry.kind === 'exam' ? entry.exam : null
    const color = course ? courseColor(course.name) : null
    const name = entryName(entry)
    const slot = course
      ? `第 ${course.startPeriod}-${course.endPeriod} 节`
      : `${exam!.startTime.slice(0, 5)}–${exam!.endTime.slice(0, 5)}`
    const location = course?.location || exam?.location
    const peers = entries.filter((peer) => entry.peerKeys.includes(peer.key))

    return (
      <Tooltip
        key={entry.key}
        title={
          <div>
            <div>
              {entry.kind === 'exam' ? '考试：' : ''}
              {name}
            </div>
            <div>
              {WEEK_DAY_NAMES[entry.dayOfWeek - 1]} · {slot}
            </div>
            {exam && <div>日期：{exam.examDate}</div>}
            <div>地点：{location || '未指定'}</div>
            {course && <div>教师：{course.teacher || '未指定'}</div>}
            {course && <div>周次：{formatWeeks(course.weeks)}</div>}
            {entry.placementNote && <div>{entry.placementNote}，请以原始时间为准。</div>}
            {peers.length > 0 && (
              <div>
                其他并列安排：{peers.map((peer) => entryName(peer)).join('、')}；均可直接点击编辑。
              </div>
            )}
          </div>
        }
      >
        <button
          type="button"
          className={`course-block tt-grid-event${exam ? ' exam-block' : ''}${positioned ? '' : ' tt-grid-unconfigured'}`}
          aria-label={`${entry.kind === 'exam' ? '考试' : '课程'}：${name}，${WEEK_DAY_NAMES[entry.dayOfWeek - 1]}，${slot}，查看或编辑`}
          data-entry-key={entry.key}
          style={{
            ...(positioned ? entryGridPosition(entry) : {}),
            ...(color
              ? { background: color.bg, borderLeftColor: color.border, color: color.text }
              : {}),
          }}
          onClick={() => (course ? onCourseClick(course) : onExamClick?.(exam!))}
        >
          {exam && <span className="course-block-exam-tag">考试</span>}
          <span className="course-block-name">{name}</span>
          <span className="tt-grid-event-slot">{slot}</span>
          {location && <span className="course-block-meta">{location}</span>}
          {course?.teacher && <span className="course-block-meta">{course.teacher}</span>}
          {entry.placementNote && <span className="tt-grid-event-note">{entry.placementNote}</span>}
          {peers.length > 0 && <span className="tt-grid-event-note">多项安排 · 并列显示</span>}
        </button>
      </Tooltip>
    )
  }

  if (periodList.length === 0) {
    return (
      <div className="tt-grid-unconfigured-list">
        <Empty description="尚未配置作息时间表；已有课程与考试仍可在下方查看或编辑。" />
        {entries.map((entry) => renderEntry(entry, false))}
      </div>
    )
  }

  return (
    <section className="tt-week-grid-region" aria-label={`第 ${week} 周课程与考试`}>
      <p className="tt-week-grid-hint">
        {hasParallelEntries ? '同一格的课程与考试已并列展示。' : ''}
        点击任一课程或考试可查看或编辑；可横向滚动查看完整一周。
      </p>
      <div
        className="timetable-grid timetable-grid-explicit"
        style={{
          minWidth: `${56 + dayLaneCounts.reduce((sum, count) => sum + count * 112, 0)}px`,
          gridTemplateColumns: `56px ${dayLaneCounts.map((count) => `minmax(${count * 112}px, 1fr)`).join(' ')}`,
          gridTemplateRows: `auto repeat(${periodList.length}, minmax(calc(68px * var(--tt-scale, 1)), auto))`,
        }}
      >
        <div className="tt-cell tt-head" style={{ gridColumn: 1, gridRow: 1 }}>
          节次
        </div>
        {WEEK_DAY_NAMES.map((name, index) => {
          const date = semesterStart ? dateOfWeekDay(semesterStart, week, index + 1) : null
          const isToday = date !== null && date.startOf('day').isSame(today)
          return (
            <div
              key={`head-${index}`}
              className={`tt-cell tt-head${isToday ? ' tt-head-today' : ''}`}
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              <span>{name}</span>
              {date && <span className="tt-head-sub">{date.format('MM-DD')}</span>}
            </div>
          )
        })}
        {periodList.flatMap((period, index) => {
          const divider = dividerRows.has(index) ? ' tt-divider' : ''
          return [
            <div
              key={`period-${period.periodNumber}`}
              className={`tt-cell tt-period${divider}`}
              style={{ gridColumn: 1, gridRow: index + 2 }}
            >
              <span className="tt-period-num">{period.periodNumber}</span>
              <span>{period.startTime.slice(0, 5)}</span>
              <span>{period.endTime.slice(0, 5)}</span>
            </div>,
            ...WEEK_DAY_NAMES.map((dayName, dayIndex) => {
              const key = `${dayIndex + 1}-${index}`
              const position = { gridColumn: dayIndex + 2, gridRow: index + 2 }
              return occupied.has(key) ? (
                <div
                  key={key}
                  className={`tt-cell tt-grid-background${divider}`}
                  style={position}
                  aria-hidden="true"
                />
              ) : (
                <button
                  key={key}
                  type="button"
                  className={`tt-cell tt-cell-empty${divider}`}
                  style={position}
                  aria-label={`${dayName}第 ${period.periodNumber} 节，新建课程`}
                  onClick={() => onEmptyClick(dayIndex + 1, period.periodNumber)}
                />
              )
            }),
          ]
        })}
        {entries.map((entry) => renderEntry(entry, true))}
      </div>
    </section>
  )
}
