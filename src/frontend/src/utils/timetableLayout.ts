import type { Course, Exam, PeriodConfig } from '../types'
import { dateOfWeekDay, dayjs } from './schedule'

interface EntryPosition {
  key: string
  dayOfWeek: number
  /** Zero-based row indexes in the sorted configured periods; endRow is exclusive. */
  startRow: number
  endRow: number
  lane: number
  laneCount: number
  peerKeys: string[]
  placementNote: string | null
}

export type TimetableEntry = EntryPosition &
  ({ kind: 'course'; course: Course } | { kind: 'exam'; exam: Exam })

interface LayoutInput {
  courses: Course[]
  exams: Exam[]
  periods: PeriodConfig[]
  week: number
  semesterStart: string | null
}

function intersectRows(rows: number[]): Pick<EntryPosition, 'startRow' | 'endRow'> {
  return { startRow: rows[0], endRow: rows[rows.length - 1] + 1 }
}

function courseRows(course: Course, periods: PeriodConfig[]) {
  const rows = periods.flatMap((period, index) =>
    period.periodNumber >= course.startPeriod && period.periodNumber <= course.endPeriod
      ? [index]
      : [],
  )
  if (rows.length) return { ...intersectRows(rows), placementNote: null }
  // Keep records with removed period settings reachable, without changing their actual period.
  const nearest = periods.reduce(
    (best, period, index) =>
      Math.abs(period.periodNumber - course.startPeriod) <
      Math.abs((periods[best]?.periodNumber ?? 1) - course.startPeriod)
        ? index
        : best,
    0,
  )
  return { startRow: nearest, endRow: nearest + 1, placementNote: '节次未配置，暂列邻近位置' }
}

function clockSeconds(time: string): number {
  const [hour, minute, second = 0] = time.split(':').map(Number)
  return hour * 3600 + minute * 60 + second
}

function examRows(exam: Exam, periods: PeriodConfig[]) {
  const start = clockSeconds(exam.startTime)
  const end = clockSeconds(exam.endTime)
  const rows = periods.flatMap((period, index) =>
    clockSeconds(period.endTime) > start && clockSeconds(period.startTime) < end ? [index] : [],
  )
  if (rows.length) return { ...intersectRows(rows), placementNote: null }
  // Before/after class or during a break: display the true clock time at the nearest row.
  // This is a visual approximation only; the exam data is never rounded or rewritten.
  const distances = periods.map((period) =>
    Math.max(clockSeconds(period.startTime) - end, start - clockSeconds(period.endTime), 0),
  )
  const nearest = Math.max(0, distances.indexOf(Math.min(...distances)))
  return { startRow: nearest, endRow: nearest + 1, placementNote: '作息时段外，暂列邻近位置' }
}

function rowsOverlap(a: TimetableEntry, b: TimetableEntry) {
  return a.startRow < b.endRow && b.startRow < a.endRow
}

/**
 * Interval partitioning preserves every record, including transitive overlaps A↔B↔C.
 * Each connected group gets enough separate lanes; later groups can use the full day width.
 */
function placeDay(entries: TimetableEntry[]): TimetableEntry[] {
  const sorted = [...entries].sort(
    (a, b) =>
      a.startRow - b.startRow ||
      a.endRow - b.endRow ||
      a.key.localeCompare(b.key, 'en', { numeric: true }),
  )
  const groups: TimetableEntry[][] = []
  let groupEnd = -1
  for (const entry of sorted) {
    if (entry.startRow >= groupEnd) groups.push([])
    groups[groups.length - 1].push(entry)
    groupEnd = Math.max(groupEnd, entry.endRow)
  }
  return groups.flatMap((group) => {
    const laneEnds: number[] = []
    const placed = group.map((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.startRow)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = entry.endRow
      return { ...entry, lane }
    })
    return placed.map((entry) => ({
      ...entry,
      laneCount: laneEnds.length,
      peerKeys: placed
        .filter((peer) => peer.key !== entry.key && rowsOverlap(entry, peer))
        .map((peer) => peer.key),
    }))
  })
}

export function buildTimetableLayout({
  courses,
  exams,
  periods,
  week,
  semesterStart,
}: LayoutInput) {
  const periodList = [...periods].sort((a, b) => a.periodNumber - b.periodNumber)
  const initial = { lane: 0, laneCount: 1, peerKeys: [] }
  const courseEntries: TimetableEntry[] = courses
    .filter((course) => course.weeks?.includes(week))
    .map((course) => ({
      ...initial,
      ...courseRows(course, periodList),
      key: `course-${course.id}`,
      kind: 'course',
      dayOfWeek: course.dayOfWeek,
      course,
    }))
  const examEntries: TimetableEntry[] = semesterStart
    ? exams.flatMap((exam) => {
        const date = dayjs(exam.examDate, 'YYYY-MM-DD', true)
        if (!date.isValid()) return []
        const dayOfWeek = date.day() || 7
        if (dateOfWeekDay(semesterStart, week, dayOfWeek).format('YYYY-MM-DD') !== exam.examDate)
          return []
        return [
          {
            ...initial,
            ...examRows(exam, periodList),
            key: `exam-${exam.id}`,
            kind: 'exam' as const,
            dayOfWeek,
            exam,
          },
        ]
      })
    : []
  const all = [...courseEntries, ...examEntries]
  const entries = Array.from({ length: 7 }, (_, index) => index + 1).flatMap((day) =>
    placeDay(all.filter((entry) => entry.dayOfWeek === day)),
  )
  const dayLaneCounts = Array.from({ length: 7 }, (_, index) =>
    Math.max(
      1,
      ...entries.filter((entry) => entry.dayOfWeek === index + 1).map((e) => e.laneCount),
    ),
  )
  const occupied = new Set<string>()
  for (const entry of entries) {
    for (let row = entry.startRow; row < entry.endRow; row++) {
      occupied.add(`${entry.dayOfWeek}-${row}`)
    }
  }
  return { periodList, entries, dayLaneCounts, occupied }
}

/** Explicit positions prevent a spanning item from shifting later days via auto-placement. */
export function entryGridPosition(entry: TimetableEntry) {
  return {
    gridColumn: entry.dayOfWeek + 1,
    gridRow: `${entry.startRow + 2} / ${entry.endRow + 2}`,
    marginInlineStart: `${(entry.lane * 100) / entry.laneCount}%`,
    marginInlineEnd: `${((entry.laneCount - entry.lane - 1) * 100) / entry.laneCount}%`,
  }
}
