package com.tangent.timetable.core.backup

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ExchangeCodecTest {
    @Test
    fun exportedV1FileRoundTripsCoreRecords() {
        val scheduleId = UUID.randomUUID().toString()
        val examId = UUID.randomUUID().toString()
        val snapshot = ExchangeSnapshot(
            sourceDatasetId = UUID.randomUUID().toString(),
            schedules = listOf(
                ExchangeSchedule(
                    publicId = scheduleId,
                    name = "秋季学期",
                    startDate = "2026-09-23",
                    endDate = "2027-01-06",
                    zoneId = "Asia/Shanghai",
                    revision = 1,
                    updatedAt = Instant.parse("2026-09-23T10:00:00Z").toString(),
                ),
            ),
            periodConfigs = listOf(ExchangePeriodConfig(1, "08:00", "08:45", "第1节")),
            courses = listOf(
                ExchangeCourse(
                    publicId = UUID.randomUUID().toString(),
                    schedulePublicId = scheduleId,
                    name = "高等数学",
                    teacher = "张老师",
                    location = "教 101",
                    colorHex = "#658C73",
                    note = "",
                    dayOfWeek = 3,
                    startPeriod = 1,
                    endPeriod = 1,
                    weeks = listOf(1, 3, 5),
                    revision = 2,
                    updatedAt = Instant.parse("2026-09-24T02:00:00Z").toString(),
                ),
            ),
            exams = listOf(
                ExchangeExam(
                    publicId = examId,
                    schedulePublicId = scheduleId,
                    name = "离散数学",
                    location = "东 201",
                    startAt = "2026-12-20T09:00",
                    endAt = "2026-12-20T11:00",
                    zoneId = "Asia/Shanghai",
                    revision = 1,
                    updatedAt = Instant.parse("2026-09-24T03:00:00Z").toString(),
                ),
            ),
            todos = listOf(
                ExchangeTodo(
                    publicId = UUID.randomUUID().toString(),
                    title = "考试：离散数学",
                    details = "东 201",
                    dueAt = "2026-12-20T09:00",
                    zoneId = "Asia/Shanghai",
                    completed = false,
                    completedAt = null,
                    examPublicId = examId,
                    revision = 1,
                    updatedAt = Instant.parse("2026-09-24T03:00:00Z").toString(),
                ),
            ),
        )

        val decoded = ExchangeCodec.decode(ExchangeCodec.encode(snapshot))

        assertEquals(snapshot, decoded)
    }

    @Test
    fun unsupportedReminderDataIsRejectedBeforeImport() {
        val json = """
            {
              "format":"tangent-timetable-exchange",
              "schemaVersion":1,
              "sourceDatasetId":"${UUID.randomUUID()}",
              "exportedAt":"2026-09-27T00:00:00Z",
              "minimumReaderVersion":"1.0.0",
              "payload":{
                "schedules":[],
                "periodConfigs":[{"periodNumber":1,"startTime":"08:00","endTime":"08:45","label":"第1节"}],
                "courses":[],
                "exams":[],
                "todos":[],
                "recurringRules":[],
                "recurringOccurrences":[],
                "todoReminders":[{"publicId":"${UUID.randomUUID()}"}],
                "examReminders":[]
              }
            }
        """.trimIndent()

        assertThrows(IllegalArgumentException::class.java) { ExchangeCodec.decode(json) }
    }
}
