import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Empty, Tooltip } from 'antd'
import { WarningFilled } from '@ant-design/icons'
import type { Course, Exam, PeriodConfig } from '../types'
import { WEEK_DAY_NAMES, dateOfWeekDay, dayjs, formatWeeks } from '../utils/schedule'

/**
 * 课程名 → 明亮色板槽位（浅底 + 深字 + 同色系实色条）。
 * 沿用旧 courseColor 的哈希算法，保证同一课程名始终落到同一颜色；
 * 取值全部走 --b-* 变量，暗色模式由设计系统自动切换。
 */
const BRIGHT_SLOTS = [
  { bg: 'var(--b-blue-soft)', bar: 'var(--b-blue)', ink: 'var(--b-blue-ink)' },
  { bg: 'var(--b-green-soft)', bar: 'var(--b-green)', ink: 'var(--b-green-ink)' },
  { bg: 'var(--b-yellow-soft)', bar: 'var(--b-yellow)', ink: 'var(--b-yellow-ink)' },
  { bg: 'var(--b-purple-soft)', bar: 'var(--b-purple)', ink: 'var(--b-purple-ink)' },
  { bg: 'var(--b-red-soft)', bar: 'var(--b-red)', ink: 'var(--b-red-ink)' },
]

function brightCourseColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 100000
  return BRIGHT_SLOTS[hash % BRIGHT_SLOTS.length]
}

/** 表头单元格：浅底 + 顶部圆角 + 粗体（明亮风） */
const headStyle: CSSProperties = {
  background: 'var(--b-bg-soft)',
  color: 'var(--b-ink)',
  fontWeight: 800,
  borderRadius: 'var(--b-radius-sm) var(--b-radius-sm) 0 0',
}
/** 今天的列表头：柔和绿高亮 */
const headTodayStyle: CSSProperties = {
  ...headStyle,
  background: 'var(--b-green-soft)',
  color: 'var(--b-green-ink)',
}
/** 时间轴列：浅底 + 弱化文字 */
const periodStyle: CSSProperties = {
  background: 'var(--b-bg-soft)',
  color: 'var(--b-ink-soft)',
}
/** 色块卡片质感：圆角 + 微浮起阴影 */
const blockStyle: CSSProperties = {
  borderRadius: 'var(--b-radius-sm)',
  boxShadow: 'var(--b-sh1)',
}

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

interface Placed {
  /** 实际展示（生效）的课程或独立考试 */
  item: GridItem
  span: number
  /** 与之冲突、被隐藏的项目 */
  conflicts: GridItem[]
}

/** 网格里的占据单元：课程，或课表外的独立考试（courseId 为空） */
interface GridItem {
  kind: 'course' | 'exam'
  id: number
  dayOfWeek: number
  startPeriod: number
  endPeriod: number
  course?: Course
  exam?: Exam
}

/** 判断两个单元的时间段是否重叠 */
function overlaps(a: GridItem, b: GridItem): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod
}

/**
 * 冲突处理：同一时段重叠的课程不并排显示（那会把后面的课挤走），
 * 而是选定其中一门作为「生效」展示，其余记录为冲突项，
 * 在该格子上以角标提示，点击可查看全部冲突课程。
 *
 * 选取规则：先按开始节次，再按 id，保证稳定且可预测。
 */
function resolveConflicts(items: GridItem[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.startPeriod - b.startPeriod || a.id - b.id)
  const result: Placed[] = []

  for (const item of sorted) {
    const existing = result.find((p) => overlaps(p.item, item))
    if (existing) {
      existing.conflicts.push(item)
    } else {
      result.push({
        item,
        span: Math.max(1, item.endPeriod - item.startPeriod + 1),
        conflicts: [],
      })
    }
  }
  return result
}

/** 独立考试起止时间 → 覆盖的节次区间（近似对齐到作息节次） */
function examPeriods(exam: Exam, periodList: PeriodConfig[]): { start: number; end: number } {
  const s = exam.startTime
  const e = exam.endTime
  let start = periodList[0]?.periodNumber ?? 1
  let end = periodList[periodList.length - 1]?.periodNumber ?? 1
  for (const p of periodList) {
    if (p.endTime >= s) {
      start = p.periodNumber
      break
    }
  }
  for (const p of periodList) {
    if (p.startTime < e) end = p.periodNumber
  }
  if (end < start) end = start
  return { start, end }
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
  const periodList = useMemo(
    () => [...periods].sort((a, b) => a.periodNumber - b.periodNumber),
    [periods],
  )

  /**
   * 所有考试（含关联课程的与独立考试）都像独立考试一样：
   * 在考试日期当天、按其起止时间对齐到的节次区间，单独占一格红色块展示。
   */
  const examItems = useMemo<GridItem[]>(() => {
    if (!semesterStart) return []
    const items: GridItem[] = []
    for (const exam of exams) {
      const dayOfWeek = dayjs(exam.examDate).day() === 0 ? 7 : dayjs(exam.examDate).day()
      const dateStr = dateOfWeekDay(semesterStart, week, dayOfWeek).format('YYYY-MM-DD')
      if (dateStr !== exam.examDate) continue
      const { start, end } = examPeriods(exam, periodList)
      items.push({
        kind: 'exam',
        id: exam.id,
        dayOfWeek,
        startPeriod: start,
        endPeriod: end,
        exam,
      })
    }
    return items
  }, [exams, semesterStart, week, periodList])

  const { cellMap, occupied } = useMemo(() => {
    const map = new Map<string, Placed>()
    const taken = new Set<string>()

    // 只展示本周有课的记录；「全部课程」由 CourseListView 以列表呈现
    const visible: GridItem[] = courses
      .filter((c) => c.weeks?.includes(week))
      .map((c) => ({
        kind: 'course' as const,
        id: c.id,
        dayOfWeek: c.dayOfWeek,
        startPeriod: c.startPeriod,
        endPeriod: c.endPeriod,
        course: c,
      }))

    const allItems = [...visible, ...examItems]

    // 按天分组后逐天解决冲突
    for (let day = 1; day <= 7; day++) {
      const dayItems = allItems.filter((i) => i.dayOfWeek === day)
      for (const placed of resolveConflicts(dayItems)) {
        map.set(`${day}-${placed.item.startPeriod}`, placed)
        for (let p = placed.item.startPeriod + 1; p <= placed.item.endPeriod; p++) {
          taken.add(`${day}-${p}`)
        }
        // 被隐藏的冲突项占用的格子也要标记，避免出现空洞可点击
        for (const c of placed.conflicts) {
          for (let p = c.startPeriod; p <= c.endPeriod; p++) {
            if (p !== placed.item.startPeriod) taken.add(`${day}-${p}`)
          }
        }
      }
    }
    return { cellMap: map, occupied: taken }
  }, [courses, examItems, week])

  /**
   * 时段分界线：上午 / 下午 / 晚上 之间加粗分隔。
   * 收集每个 category 最后一节的节次号（最末一节不需要，因为表格自带外边框）。
   */
  const dividerPeriods = useMemo(() => {
    const set = new Set<number>()
    for (let i = 0; i < periodList.length - 1; i++) {
      if (periodList[i].category !== periodList[i + 1].category) {
        set.add(periodList[i].periodNumber)
      }
    }
    return set
  }, [periodList])

  if (periodList.length === 0) {
    return <Empty description="尚未配置作息时间表" />
  }

  const today = dayjs().startOf('day')

  const headers = WEEK_DAY_NAMES.map((name, index) => {
    const dayOfWeek = index + 1
    const date = semesterStart ? dateOfWeekDay(semesterStart, week, dayOfWeek) : null
    const isToday = date !== null && date.startOf('day').isSame(today)
    return (
      <div
        key={`head-${dayOfWeek}`}
        className={`tt-cell tt-head${isToday ? ' tt-head-today' : ''}`}
        style={isToday ? headTodayStyle : headStyle}
      >
        <span>{name}</span>
        {date && <span className="tt-head-sub">{date.format('MM-DD')}</span>}
      </div>
    )
  })

  const rows = periodList.flatMap((period) => {
    // 该行是否为时段分界行（上午/下午/晚上交界）
    const isDivider = dividerPeriods.has(period.periodNumber)
    const div = isDivider ? ' tt-divider' : ''

    const cells = [
      <div
        key={`p-${period.periodNumber}`}
        className={`tt-cell tt-period${div}`}
        style={periodStyle}
      >
        <span className="tt-period-num" style={{ color: 'var(--b-ink)', fontWeight: 900 }}>
          {period.periodNumber}
        </span>
        <span>{period.startTime?.slice(0, 5)}</span>
        <span>{period.endTime?.slice(0, 5)}</span>
      </div>,
    ]

    for (let day = 1; day <= 7; day++) {
      const key = `${day}-${period.periodNumber}`
      const placed = cellMap.get(key)

      if (placed) {
        const { item, span, conflicts } = placed
        const hasConflict = conflicts.length > 0
        const spanDiv = dividerPeriods.has(item.endPeriod) ? ' tt-divider' : ''

        // 考试块（含关联课程与独立考试）单独占一格展示
        if (item.kind === 'exam') {
          const exam = item.exam!
          cells.push(
            <div
              key={`e-${key}`}
              className={`tt-cell${spanDiv}`}
              style={{ gridRow: `span ${span}` }}
            >
              <Tooltip
                title={
                  <div>
                    <div>{exam.name}</div>
                    <div>日期:{exam.examDate}</div>
                    <div>
                      时间:{exam.startTime?.slice(0, 5)}-{exam.endTime?.slice(0, 5)}
                    </div>
                    <div>地点:{exam.location || '未指定'}</div>
                  </div>
                }
              >
                <div
                  className="course-block exam-block"
                  style={{
                    ...blockStyle,
                    background: 'var(--b-red-soft)',
                    borderLeftColor: 'var(--b-red)',
                    color: 'var(--b-red-ink)',
                    height: '100%',
                  }}
                  onClick={() => onExamClick?.(exam)}
                >
                  <div
                    className="course-block-exam-tag"
                    style={{
                      background: 'var(--bg-card)',
                      border: '2px solid var(--b-red)',
                      color: 'var(--b-red-ink)',
                      borderRadius: 99,
                      fontWeight: 900,
                      padding: '0 7px',
                    }}
                  >
                    考
                  </div>
                  <div
                    className="course-block-name"
                    style={{ color: 'var(--b-red-ink)', fontWeight: 800 }}
                  >
                    {exam.name}
                  </div>
                  <div className="course-block-exam-time" style={{ color: 'var(--b-red-ink)' }}>
                    <span>{exam.startTime?.slice(0, 5)}</span>
                    <span>{exam.endTime?.slice(0, 5)}</span>
                  </div>
                  {exam.location && (
                    <div className="course-block-meta" style={{ color: 'var(--b-red-ink)' }}>
                      {exam.location}
                    </div>
                  )}
                </div>
              </Tooltip>
            </div>,
          )
          continue
        }

        // 课程块
        const course = item.course!
        const color = brightCourseColor(course.name)
        cells.push(
          <div key={`c-${key}`} className={`tt-cell${spanDiv}`} style={{ gridRow: `span ${span}` }}>
            <Tooltip
              title={
                <div>
                  <div>{course.name}</div>
                  <div>地点：{course.location || '未指定'}</div>
                  <div>教师：{course.teacher || '未指定'}</div>
                  <div>
                    第 {course.startPeriod}-{course.endPeriod} 节
                  </div>
                  <div>周次：{formatWeeks(course.weeks)}</div>
                  {hasConflict && (
                    <div style={{ marginTop: 6, borderTop: '1px solid var(--b-line)', paddingTop: 6 }}>
                      <div>⚠ 此时段有 {conflicts.length} 项冲突（未显示）：</div>
                      {conflicts.map((c) => (
                        <div key={c.id}>
                          · {c.kind === 'exam' ? `考试 ${c.exam?.name}` : c.course?.name}（第{' '}
                          {c.startPeriod}-{c.endPeriod} 节
                          {c.kind === 'course' && c.course?.location
                            ? `，${c.course.location}`
                            : ''}
                          ）
                        </div>
                      ))}
                      <div style={{ marginTop: 4 }}>以上内容不会显示在课表中，请调整或删除。</div>
                    </div>
                  )}
                </div>
              }
            >
              <div
                className="course-block"
                style={{
                  ...blockStyle,
                  background: color.bg,
                  borderLeftColor: hasConflict ? 'var(--b-red)' : color.bar,
                  color: color.ink,
                  height: '100%',
                }}
                onClick={() => onCourseClick(course)}
              >
                {hasConflict && (
                  <span
                    className="course-conflict-badge"
                    style={{ color: 'var(--b-red-ink)', fontWeight: 900 }}
                  >
                    <WarningFilled /> {conflicts.length}
                  </span>
                )}
                <div className="course-block-name" style={{ fontWeight: 800 }}>
                  {course.name}
                </div>
                {course.location && <div className="course-block-meta">{course.location}</div>}
                {course.teacher && <div className="course-block-meta">{course.teacher}</div>}
              </div>
            </Tooltip>
          </div>,
        )
      } else if (!occupied.has(key)) {
        cells.push(
          <div
            key={`e-${key}`}
            className={`tt-cell tt-cell-empty${div}`}
            onClick={() => onEmptyClick(day, period.periodNumber)}
          />,
        )
      }
    }
    return cells
  })

  return (
    <div
      className="timetable-grid"
      style={
        {
          border: '1px solid var(--b-line)',
          borderRadius: 'var(--b-radius)',
          boxShadow: 'var(--b-sh2)',
          // 内容过高时允许滚动而非裁掉底部节次（min-content = 表头 + 各节次最小行高之和）
          minHeight: 'min-content',
          // 网格线 / 时段分隔线 / 空格悬停色在本作用域内改走明亮变量
          '--border-light': 'var(--b-line)',
          '--border-dark': 'var(--b-line)',
          '--bg-main': 'var(--b-bg-soft)',
        } as CSSProperties
      }
    >
      <div className="tt-cell tt-head" style={headStyle}>
        节次
      </div>
      {headers}
      {rows}
    </div>
  )
}
