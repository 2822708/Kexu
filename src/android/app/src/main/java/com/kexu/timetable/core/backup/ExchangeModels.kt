package com.kexu.timetable.core.backup

data class ExchangeSnapshot(
    val sourceDatasetId: String,
    val schedules: List<ExchangeSchedule>,
    val periodConfigs: List<ExchangePeriodConfig>,
    val courses: List<ExchangeCourse>,
    val exams: List<ExchangeExam>,
    val todos: List<ExchangeTodo>,
)

data class ExchangeSchedule(
    val publicId: String,
    val name: String,
    val startDate: String,
    val endDate: String,
    val zoneId: String,
    val revision: Long,
    val updatedAt: String,
)

data class ExchangePeriodConfig(
    val periodNumber: Int,
    val startTime: String,
    val endTime: String,
    val label: String,
)

data class ExchangeCourse(
    val publicId: String,
    val schedulePublicId: String,
    val name: String,
    val teacher: String,
    val location: String,
    val colorHex: String,
    val note: String,
    val dayOfWeek: Int,
    val startPeriod: Int,
    val endPeriod: Int,
    val weeks: List<Int>,
    val revision: Long,
    val updatedAt: String,
)

data class ExchangeExam(
    val publicId: String,
    val schedulePublicId: String,
    val name: String,
    val location: String,
    val startAt: String,
    val endAt: String,
    val zoneId: String,
    val revision: Long,
    val updatedAt: String,
)

data class ExchangeTodo(
    val publicId: String,
    val title: String,
    val details: String,
    val dueAt: String?,
    val zoneId: String,
    val completed: Boolean,
    val completedAt: String?,
    val examPublicId: String?,
    val revision: Long,
    val updatedAt: String,
)

data class ExchangeImportSummary(
    val sourceDatasetId: String,
    val schedules: Int,
    val courses: Int,
    val exams: Int,
    val todos: Int,
    val periods: Int,
)
