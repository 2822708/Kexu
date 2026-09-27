import type { Course, CoursePayload, ParsedCourse } from '../types'

export interface ImportRow extends ParsedCourse {
  key: number
  errors: string[]
  warnings: string[]
}

/** AI output is untrusted; normalize its shape before rendering or comparing rows. */
export function diagnoseCourses(
  parsed: readonly ParsedCourse[],
  existing: readonly Course[],
  totalWeeks: number,
  periodNumbers: readonly number[],
): ImportRow[] {
  const availablePeriods = new Set(periodNumbers)
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : null)
  const integer = (value: unknown) => (Number.isInteger(value) ? (value as number) : null)
  const rows = parsed.map((value, key): ImportRow => {
    const source = value ?? {} as ParsedCourse
    const row: ImportRow = {
      key,
      name: text(source.name), location: text(source.location), teacher: text(source.teacher),
      dayOfWeek: integer(source.dayOfWeek),
      startPeriod: integer(source.startPeriod), endPeriod: integer(source.endPeriod),
      weeks: Array.isArray(source.weeks) ? source.weeks.filter((w) => Number.isInteger(w)) : [],
      errors: [], warnings: [],
    }
    if (!row.name) row.errors.push('缺少课程名称')
    if ((row.name?.length ?? 0) > 200) row.errors.push('课程名称超过 200 字')
    if ((row.location?.length ?? 0) > 200) row.errors.push('地点超过 200 字')
    if ((row.teacher?.length ?? 0) > 100) row.errors.push('教师名称超过 100 字')
    if (row.dayOfWeek === null || row.dayOfWeek < 1 || row.dayOfWeek > 7) row.errors.push('星期须为 1–7')
    if (row.startPeriod === null || row.endPeriod === null || row.startPeriod < 1 ||
        row.endPeriod > 12 || row.startPeriod > row.endPeriod) {
      row.errors.push('节次须在 1–12 内，且结束不早于开始')
    } else if (availablePeriods.size &&
        Array.from({ length: row.endPeriod - row.startPeriod + 1 }, (_, i) => row.startPeriod! + i)
          .some((p) => !availablePeriods.has(p))) {
      row.errors.push('节次未在作息表中配置')
    }
    if (!Array.isArray(source.weeks) || source.weeks.length === 0) {
      row.errors.push('缺少上课周次')
    } else {
      if (source.weeks.length > 52) row.errors.push('周次数量超过 52')
      if (source.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > Math.min(totalWeeks, 52))) {
        row.errors.push(`周次必须为 1–${Math.min(totalWeeks, 52)} 的整数`)
      }
      if (new Set(row.weeks).size !== row.weeks.length) row.warnings.push('重复周次已合并')
    }
    row.weeks = [...new Set(row.weeks)].sort((a, b) => a - b)
    return row
  })

  for (const row of rows) {
    if (row.errors.length) continue
    const duplicate = existing.find((c) => isSameCourse(row, c))
    const earlier = rows.slice(0, row.key).find((c) => c.errors.length === 0 && isSameCourse(row, c))
    if (duplicate) row.errors.push(`与已有课程「${duplicate.name}」完全重复`)
    else if (earlier) row.errors.push(`与导入第 ${earlier.key + 1} 行完全重复`)
  }
  for (const row of rows) {
    if (row.errors.length) continue
    const conflicts = existing.filter((c) => overlaps(row, c))
    const incoming = rows.filter((c) => c.key !== row.key && c.errors.length === 0 && overlaps(row, c))
    if (conflicts.length) row.warnings.push(`与已有课程冲突：${conflicts.map((c) => c.name).join('、')}`)
    if (incoming.length) row.warnings.push(`与导入第 ${incoming.map((c) => c.key + 1).join('、')} 行时间冲突`)
  }
  return rows
}

function isSameCourse(a: ParsedCourse, b: ParsedCourse): boolean {
  return a.name === b.name?.trim() && (a.location || '') === (b.location?.trim() || '') &&
    (a.teacher || '') === (b.teacher?.trim() || '') && a.dayOfWeek === b.dayOfWeek &&
    a.startPeriod === b.startPeriod && a.endPeriod === b.endPeriod &&
    a.weeks.join(',') === [...new Set(b.weeks)].sort((x, y) => x - y).join(',')
}

function overlaps(a: ParsedCourse, b: ParsedCourse): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startPeriod! <= b.endPeriod! &&
    a.endPeriod! >= b.startPeriod! && a.weeks.some((w) => b.weeks.includes(w))
}

/** Only validated rows are converted to a write payload. */
export function importPayload(row: ImportRow): CoursePayload {
  if (row.errors.length) throw new Error(`第 ${row.key + 1} 行无效，不能导入`)
  return {
    name: row.name!, location: row.location || null, teacher: row.teacher || null,
    dayOfWeek: row.dayOfWeek!, startPeriod: row.startPeriod!, endPeriod: row.endPeriod!,
    weeks: row.weeks,
  }
}
