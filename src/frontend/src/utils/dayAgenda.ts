import type { Course, Exam, PeriodConfig, Schedule } from '../types'
import { currentWeekOf, dayjs } from './schedule'

export type TermDayStatus = 'in-term' | 'before-term' | 'after-term' | 'invalid'

/** Week 1 starts on the ISO Monday of the start date, but courses stay within the actual term dates. */
export function dayAgenda(
  date: string,
  schedule: Pick<Schedule, 'periodStartDate' | 'periodEndDate'>,
  courses: Course[],
  exams: Exam[],
) {
  const selected = dayjs(date, 'YYYY-MM-DD', true)
  const start = dayjs(schedule.periodStartDate, 'YYYY-MM-DD', true)
  const end = dayjs(schedule.periodEndDate, 'YYYY-MM-DD', true)
  let status: TermDayStatus = 'in-term'
  if (!selected.isValid() || !start.isValid() || !end.isValid() || end.isBefore(start, 'day')) {
    status = 'invalid'
  } else if (selected.isBefore(start, 'day')) {
    status = 'before-term'
  } else if (selected.isAfter(end, 'day')) {
    status = 'after-term'
  }
  const week = status === 'invalid' ? null : currentWeekOf(schedule.periodStartDate, selected)
  const dayOfWeek = selected.isValid() ? selected.isoWeekday() : null
  return {
    status,
    week,
    dayOfWeek,
    courses:
      status === 'in-term'
        ? courses
            .filter((course) => course.dayOfWeek === dayOfWeek && course.weeks?.includes(week!))
            .sort(
              (a, b) => a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod || a.id - b.id,
            )
        : [],
    // Exams have explicit dates. Keep them visible even when scheduled outside the course term.
    exams: selected.isValid()
      ? exams
          .filter((exam) => exam.examDate === date)
          .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id)
      : [],
  }
}

/** Only display configured clock times; missing period settings must not invent a time. */
export function courseClockTime(course: Course, periods: PeriodConfig[]): string | null {
  const start = periods.find((period) => period.periodNumber === course.startPeriod)?.startTime
  const end = periods.find((period) => period.periodNumber === course.endPeriod)?.endTime
  return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : null
}
