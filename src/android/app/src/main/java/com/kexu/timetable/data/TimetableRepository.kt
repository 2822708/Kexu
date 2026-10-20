package com.kexu.timetable.data

import androidx.room.withTransaction
import com.kexu.timetable.core.database.CourseDao
import com.kexu.timetable.core.database.CourseEntity
import com.kexu.timetable.core.database.ExamDao
import com.kexu.timetable.core.database.ExamEntity
import com.kexu.timetable.core.database.PeriodConfigDao
import com.kexu.timetable.core.database.ScheduleDao
import com.kexu.timetable.core.database.ScheduleEntity
import com.kexu.timetable.core.database.TimetableDatabase
import com.kexu.timetable.core.database.TodoDao
import com.kexu.timetable.core.database.TodoEntity
import com.kexu.timetable.core.domain.CourseRules
import com.kexu.timetable.core.domain.CourseSlot
import com.kexu.timetable.core.time.TermWeekCalculator
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID

class DomainValidationException(message: String) : IllegalArgumentException(message)

class TimetableRepository(val database: TimetableDatabase) {
    private val schedules: ScheduleDao = database.scheduleDao()
    private val periods: PeriodConfigDao = database.periodConfigDao()
    private val courses: CourseDao = database.courseDao()
    private val exams: ExamDao = database.examDao()
    private val todos: TodoDao = database.todoDao()

    fun observeSchedules(): Flow<List<ScheduleEntity>> = schedules.observeAll()

    fun observePeriods() = periods.observeAll()

    fun observeCourses(scheduleId: Long, dayOfWeek: Int, week: Int): Flow<List<CourseEntity>> =
        courses.observeDay(scheduleId, dayOfWeek).map { dayCourses ->
            dayCourses.filter { week in it.weeks }
        }

    fun observeExams(scheduleId: Long): Flow<List<ExamEntity>> =
        exams.observeForSchedule(scheduleId)

    fun observeTodos(): Flow<List<TodoEntity>> = todos.observeAll()

    suspend fun createSchedule(
        name: String,
        startDateText: String,
        endDateText: String,
        zoneIdText: String,
    ): Long {
        val normalizedName = name.trim()
        if (normalizedName.isEmpty()) throw DomainValidationException("请填写课表名称")
        val startDate = parseDate(startDateText, "开学日期")
        val endDate = parseDate(endDateText, "结束日期")
        if (endDate.isBefore(startDate)) throw DomainValidationException("结束日期不能早于开学日期")
        val zoneId = try {
            ZoneId.of(zoneIdText).id
        } catch (_: Exception) {
            throw DomainValidationException("时区格式无效")
        }
        return schedules.insert(
            ScheduleEntity(
                name = normalizedName,
                startDate = startDate.toString(),
                endDate = endDate.toString(),
                zoneId = zoneId,
            ),
        )
    }

    suspend fun findSchedule(localId: Long): ScheduleEntity? = schedules.findByLocalId(localId)

    suspend fun saveCourse(input: CourseEntity) {
        val normalizedName = input.name.trim()
        if (normalizedName.isEmpty()) throw DomainValidationException("请填写课程名称")
        if (input.dayOfWeek !in 1..7) throw DomainValidationException("星期范围必须为周一至周日")

        database.withTransaction {
            val schedule = schedules.findByLocalId(input.scheduleLocalId)
                ?: throw DomainValidationException("当前课表不存在")
            val weekCount = TermWeekCalculator.totalWeeks(
                LocalDate.parse(schedule.startDate),
                LocalDate.parse(schedule.endDate),
            )
            val weeks = input.weeks.distinct().sorted()
            if (weeks.isEmpty()) throw DomainValidationException("至少选择一个教学周")
            if (weeks.any { it !in 1..weekCount }) {
                throw DomainValidationException("教学周必须在第 1 到第 " + weekCount + " 周之间")
            }

            val maxPeriod = periods.getAll().maxOfOrNull { it.periodNumber } ?: 0
            if (input.startPeriod !in 1..maxPeriod || input.endPeriod !in input.startPeriod..maxPeriod) {
                throw DomainValidationException("节次范围必须在第 1 到第 " + maxPeriod + " 节之间")
            }

            val candidates = courses.getForSchedule(input.scheduleLocalId)
            val candidateSlot = CourseSlot(
                publicId = input.publicId,
                dayOfWeek = input.dayOfWeek,
                startPeriod = input.startPeriod,
                endPeriod = input.endPeriod,
                weeks = weeks.toSet(),
            )
            val existingSlots = candidates.map { course ->
                CourseSlot(course.publicId, course.dayOfWeek, course.startPeriod, course.endPeriod, course.weeks.toSet())
            }
            val conflict = CourseRules.findConflict(candidateSlot, existingSlots)
            if (conflict != null) throw DomainValidationException("与已有课程的星期、节次和教学周冲突，请先调整其中一门课程")

            val old = if (input.localId > 0) candidates.firstOrNull { it.localId == input.localId } else null
            val saved = input.copy(
                name = normalizedName,
                teacher = input.teacher.trim(),
                location = input.location.trim(),
                weeks = weeks,
                revision = (old?.revision ?: 0L) + 1L,
                updatedAt = Instant.now().toString(),
            )
            if (old == null) courses.insert(saved.copy(localId = 0)) else courses.update(saved)
        }
    }

    suspend fun deleteCourse(localId: Long) {
        courses.deleteByLocalId(localId)
    }

    suspend fun saveExam(input: ExamEntity) {
        val normalizedName = input.name.trim()
        if (normalizedName.isEmpty()) throw DomainValidationException("请填写考试名称")
        val startAt = parseDateTime(input.startAt, "考试开始时间")
        val endAt = parseDateTime(input.endAt, "考试结束时间")
        if (!endAt.isAfter(startAt)) throw DomainValidationException("考试结束时间必须晚于开始时间")
        val zoneId = try {
            ZoneId.of(input.zoneId).id
        } catch (_: Exception) {
            throw DomainValidationException("考试时区格式无效")
        }

        database.withTransaction {
            if (schedules.findByLocalId(input.scheduleLocalId) == null) {
                throw DomainValidationException("当前课表不存在")
            }
            val old = if (input.localId > 0) exams.findByLocalId(input.localId) else null
            val saved = input.copy(
                name = normalizedName,
                location = input.location.trim(),
                startAt = startAt.toString(),
                endAt = endAt.toString(),
                zoneId = zoneId,
                revision = (old?.revision ?: 0L) + 1L,
                updatedAt = Instant.now().toString(),
            )
            val examLocalId = if (old == null) {
                exams.insert(saved.copy(localId = 0))
            } else {
                exams.update(saved)
                old.localId
            }
            val attachedTodo = todos.findForExam(examLocalId)
            val todo = TodoEntity(
                localId = attachedTodo?.localId ?: 0,
                publicId = attachedTodo?.publicId ?: UUID.randomUUID().toString(),
                title = "考试：" + normalizedName,
                details = saved.location,
                dueAt = saved.startAt,
                zoneId = saved.zoneId,
                completed = attachedTodo?.completed ?: false,
                completedAt = attachedTodo?.completedAt,
                examLocalId = examLocalId,
                revision = (attachedTodo?.revision ?: 0L) + 1L,
                updatedAt = Instant.now().toString(),
            )
            if (attachedTodo == null) todos.insert(todo) else todos.update(todo)
        }
    }

    suspend fun deleteExam(localId: Long) {
        database.withTransaction {
            exams.deleteByLocalId(localId)
        }
    }

    suspend fun reconcilePastExamTodos(): Int = database.withTransaction {
        val now = Instant.now()
        var completedCount = 0
        exams.getAll().forEach { exam ->
            val endInstant = LocalDateTime.parse(exam.endAt)
                .atZone(ZoneId.of(exam.zoneId))
                .toInstant()
            if (!endInstant.isAfter(now)) {
                val todo = todos.findForExam(exam.localId)
                if (todo != null && !todo.completed) {
                    todos.update(
                        todo.copy(
                            completed = true,
                            completedAt = now.toString(),
                            revision = todo.revision + 1,
                            updatedAt = now.toString(),
                        ),
                    )
                    completedCount++
                }
            }
        }
        completedCount
    }

    suspend fun addTodo(title: String, details: String, dueAtText: String?, zoneIdText: String): Long {
        val normalizedTitle = title.trim()
        if (normalizedTitle.isEmpty()) throw DomainValidationException("请填写待办标题")
        val dueAt = dueAtText?.trim()?.takeIf { it.isNotEmpty() }?.let { parseDateTime(it, "截止时间").toString() }
        val zoneId = try {
            ZoneId.of(zoneIdText).id
        } catch (_: Exception) {
            throw DomainValidationException("待办时区格式无效")
        }
        return todos.insert(
            TodoEntity(
                title = normalizedTitle,
                details = details.trim(),
                dueAt = dueAt,
                zoneId = zoneId,
            ),
        )
    }

    suspend fun setTodoCompleted(localId: Long, completed: Boolean) {
        val todo = todos.findByLocalId(localId) ?: return
        if (todo.completed == completed) return
        todos.update(
            todo.copy(
                completed = completed,
                completedAt = if (completed) Instant.now().toString() else null,
                revision = todo.revision + 1,
                updatedAt = Instant.now().toString(),
            ),
        )
    }

    suspend fun deleteTodo(localId: Long) {
        val todo = todos.findByLocalId(localId) ?: return
        if (todo.examLocalId != null) {
            throw DomainValidationException("这条待办由考试自动关联，请到考试列表中删除对应考试")
        }
        todos.deleteStandaloneByLocalId(localId)
    }

    private fun parseDate(value: String, label: String): LocalDate =
        try {
            LocalDate.parse(value)
        } catch (_: Exception) {
            throw DomainValidationException(label + "格式应为 YYYY-MM-DD")
        }

    private fun parseDateTime(value: String, label: String): LocalDateTime =
        try {
            LocalDateTime.parse(value)
        } catch (_: Exception) {
            throw DomainValidationException(label + "格式应为 YYYY-MM-DD HH:mm")
        }
}
