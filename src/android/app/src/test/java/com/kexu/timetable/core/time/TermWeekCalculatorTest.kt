package com.kexu.timetable.core.time

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class TermWeekCalculatorTest {
    @Test
    fun weekOneStartsOnMondayOfTermStartWeek() {
        assertEquals(LocalDate.parse("2026-09-21"), TermWeekCalculator.weekOneMonday(LocalDate.parse("2026-09-23")))
        assertEquals(1, TermWeekCalculator.weekFor(LocalDate.parse("2026-09-23"), LocalDate.parse("2026-09-21")))
        assertEquals(2, TermWeekCalculator.weekFor(LocalDate.parse("2026-09-23"), LocalDate.parse("2026-09-28")))
    }

    @Test
    fun datesBeforeWeekOneUseZeroOrNegativeTeachingWeeks() {
        assertEquals(0, TermWeekCalculator.weekFor(LocalDate.parse("2026-09-23"), LocalDate.parse("2026-09-14")))
    }

    @Test
    fun termWeekCountIncludesTheWeekContainingItsLastDay() {
        assertEquals(
            16,
            TermWeekCalculator.totalWeeks(
                LocalDate.parse("2026-09-23"),
                LocalDate.parse("2027-01-06"),
            ),
        )
    }
}
