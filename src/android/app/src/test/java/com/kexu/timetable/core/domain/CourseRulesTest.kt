package com.kexu.timetable.core.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CourseRulesTest {
    @Test
    fun overlappingSectionsConflictOnlyWhenWeekSetsAlsoOverlap() {
        val existing = CourseSlot("a", dayOfWeek = 1, startPeriod = 1, endPeriod = 2, weeks = setOf(1, 3))
        val sameWeeks = CourseSlot("b", 1, 2, 3, setOf(3, 4))
        val differentWeeks = CourseSlot("c", 1, 2, 3, setOf(2, 4))

        assertEquals(existing, CourseRules.findConflict(sameWeeks, listOf(existing)))
        assertNull(CourseRules.findConflict(differentWeeks, listOf(existing)))
    }

    @Test
    fun adjacentPeriodsAndDifferentDaysDoNotConflict() {
        val existing = CourseSlot("a", 1, 1, 2, setOf(1))
        assertNull(CourseRules.findConflict(CourseSlot("b", 1, 3, 4, setOf(1)), listOf(existing)))
        assertNull(CourseRules.findConflict(CourseSlot("c", 2, 1, 2, setOf(1)), listOf(existing)))
    }
}
