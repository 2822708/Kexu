package com.kexu.timetable.core.time

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.time.temporal.ChronoUnit

object TermWeekCalculator {
    fun weekOneMonday(termStartDate: LocalDate): LocalDate =
        termStartDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    fun totalWeeks(termStartDate: LocalDate, termEndDate: LocalDate): Int {
        require(!termEndDate.isBefore(termStartDate)) { "学期结束日期不能早于开始日期" }
        val days = ChronoUnit.DAYS.between(weekOneMonday(termStartDate), termEndDate)
        return (days / 7L).toInt() + 1
    }

    fun weekFor(termStartDate: LocalDate, date: LocalDate): Int {
        val days = ChronoUnit.DAYS.between(weekOneMonday(termStartDate), date)
        return Math.floorDiv(days, 7L).toInt() + 1
    }

    fun dateFor(termStartDate: LocalDate, week: Int, isoDayOfWeek: Int): LocalDate {
        require(week >= 1) { "周次必须从 1 开始" }
        require(isoDayOfWeek in 1..7) { "星期范围必须为 1 到 7" }
        return weekOneMonday(termStartDate)
            .plusWeeks((week - 1).toLong())
            .plusDays((isoDayOfWeek - 1).toLong())
    }
}
