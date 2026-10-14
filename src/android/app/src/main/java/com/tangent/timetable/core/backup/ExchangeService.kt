package com.tangent.timetable.core.backup

import androidx.room.withTransaction
import com.tangent.timetable.core.database.CourseEntity
import com.tangent.timetable.core.database.ExamEntity
import com.tangent.timetable.core.database.ScheduleEntity
import com.tangent.timetable.core.database.TimetableDatabase
import com.tangent.timetable.core.database.TodoEntity
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ExchangeApplyResult(
    val schedules: Int,
    val courses: Int,
    val exams: Int,
    val todos: Int,
    val mode: ImportMode,
)

enum class ImportMode { MERGE, REPLACE }

class ExchangeService(private val database: TimetableDatabase) {
    private var pendingImport: ExchangeSnapshot? = null

    suspend fun exportJson(): String = withContext(Dispatchers.IO) {
        val snapshot = database.withTransaction {
            val scheduleRows = database.scheduleDao().getAll()
            val scheduleIds = scheduleRows.associate { it.localId to it.publicId }
            val examsById = scheduleRows
                .flatMap { database.examDao().getForSchedule(it.localId) }
                .associateBy { it.localId }
            val examPublicIds = examsById.mapValues { it.value.publicId }
            val courses = scheduleRows.flatMap { schedule ->
                database.courseDao().getForSchedule(schedule.localId).map { course ->
                    ExchangeCourse(
                        publicId = course.publicId,
                        schedulePublicId = schedule.publicId,
                        name = course.name,
                        teacher = course.teacher,
                        location = course.location,
                        colorHex = course.colorHex,
                        note = course.note,
                        dayOfWeek = course.dayOfWeek,
                        startPeriod = course.startPeriod,
                        endPeriod = course.endPeriod,
                        weeks = course.weeks,
                        revision = course.revision,
                        updatedAt = course.updatedAt,
                    )
                }
            }
            val exams = examsById.values.map { exam ->
                ExchangeExam(
                    publicId = exam.publicId,
                    schedulePublicId = scheduleIds[exam.scheduleLocalId] ?: error("考试课表不存在"),
                    name = exam.name,
                    location = exam.location,
                    startAt = exam.startAt,
                    endAt = exam.endAt,
                    zoneId = exam.zoneId,
                    revision = exam.revision,
                    updatedAt = exam.updatedAt,
                )
            }
            val todos = database.todoDao().getAll().map { todo ->
                ExchangeTodo(
                    publicId = todo.publicId,
                    title = todo.title,
                    details = todo.details,
                    dueAt = todo.dueAt,
                    zoneId = todo.zoneId,
                    completed = todo.completed,
                    completedAt = todo.completedAt,
                    examPublicId = todo.examLocalId?.let { examPublicIds[it] },
                    revision = todo.revision,
                    updatedAt = todo.updatedAt,
                )
            }
            ExchangeSnapshot(
                sourceDatasetId = database.appMetadataDao().get()?.sourceDatasetId
                    ?: throw IllegalStateException("本机数据集元数据缺失"),
                schedules = scheduleRows.map { it.toExchangeSchedule() },
                periodConfigs = database.periodConfigDao().getAll().map {
                    ExchangePeriodConfig(it.periodNumber, it.startTime, it.endTime, it.label)
                },
                courses = courses,
                exams = exams,
                todos = todos,
            )
        }
        ExchangeCodec.encode(snapshot)
    }

    suspend fun previewImport(input: InputStream): ExchangeImportSummary = withContext(Dispatchers.IO) {
        val text = readBounded(input)
        val parsed = ExchangeCodec.decode(text)
        pendingImport = parsed
        ExchangeImportSummary(
            sourceDatasetId = parsed.sourceDatasetId,
            schedules = parsed.schedules.size,
            courses = parsed.courses.size,
            exams = parsed.exams.size,
            todos = parsed.todos.size,
            periods = parsed.periodConfigs.size,
        )
    }

    suspend fun applyPendingImport(mode: ImportMode): ExchangeApplyResult = withContext(Dispatchers.IO) {
        val snapshot = pendingImport ?: throw IllegalStateException("导入预览已失效，请重新选择文件")
        val counts = database.withTransaction {
            if (mode == ImportMode.REPLACE) {
                database.todoDao().deleteAll()
                database.scheduleDao().deleteAll()
                database.periodConfigDao().deleteAll()
            } else {
                checkMergeConflicts(snapshot)
            }
            applySchedules(snapshot)
            applyPeriods(snapshot, mode)
            applyCourses(snapshot)
            applyExams(snapshot)
            applyTodos(snapshot)
            ExchangeApplyResult(
                schedules = snapshot.schedules.size,
                courses = snapshot.courses.size,
                exams = snapshot.exams.size,
                todos = snapshot.todos.size,
                mode = mode,
            )
        }
        pendingImport = null
        counts
    }

    fun discardPendingImport() {
        pendingImport = null
    }

    private suspend fun checkMergeConflicts(snapshot: ExchangeSnapshot) {
        val scheduleDao = database.scheduleDao()
        val courseDao = database.courseDao()
        val examDao = database.examDao()
        val todoDao = database.todoDao()

        snapshot.schedules.forEach { incoming ->
            val existing = scheduleDao.findByPublicId(incoming.publicId)
            if (existing != null && existing.toExchangeSchedule() != incoming) {
                conflict("课表", incoming.name)
            }
        }
        val existingPeriods = database.periodConfigDao().getAll().associateBy { it.periodNumber }
        snapshot.periodConfigs.forEach { incoming ->
            val existing = existingPeriods[incoming.periodNumber]
            if (existing != null &&
                (existing.startTime != incoming.startTime || existing.endTime != incoming.endTime || existing.label != incoming.label)
            ) {
                conflict("第 " + incoming.periodNumber + " 节作息")
            }
        }
        snapshot.courses.forEach { incoming ->
            val existing = courseDao.findByPublicId(incoming.publicId)
            if (existing != null && existing.toExchangeCourse() != incoming) conflict("课程", incoming.name)
        }
        snapshot.exams.forEach { incoming ->
            val existing = examDao.findByPublicId(incoming.publicId)
            if (existing != null && existing.toExchangeExam() != incoming) conflict("考试", incoming.name)
        }
        snapshot.todos.forEach { incoming ->
            val existing = todoDao.findByPublicId(incoming.publicId)
            if (existing != null && existing.toExchangeTodo(database) != incoming) conflict("待办", incoming.title)
        }

        snapshot.schedules.forEach { schedule ->
            val existingSchedule = scheduleDao.findByPublicId(schedule.publicId) ?: return@forEach
            val accepted = courseDao.getForSchedule(existingSchedule.localId)
                .map {
                    com.tangent.timetable.core.domain.CourseSlot(
                        it.publicId,
                        it.dayOfWeek,
                        it.startPeriod,
                        it.endPeriod,
                        it.weeks.toSet(),
                    )
                }
                .toMutableList()
            snapshot.courses.filter { it.schedulePublicId == schedule.publicId }.forEach { incoming ->
                if (accepted.none { it.publicId == incoming.publicId }) {
                    val candidate = com.tangent.timetable.core.domain.CourseSlot(
                        incoming.publicId,
                        incoming.dayOfWeek,
                        incoming.startPeriod,
                        incoming.endPeriod,
                        incoming.weeks.toSet(),
                    )
                    if (com.tangent.timetable.core.domain.CourseRules.findConflict(candidate, accepted) != null) {
                        conflict("课程", incoming.name)
                    }
                    accepted += candidate
                }
            }
        }
    }

    private suspend fun applySchedules(snapshot: ExchangeSnapshot) {
        val dao = database.scheduleDao()
        snapshot.schedules.forEach { incoming ->
            if (dao.findByPublicId(incoming.publicId) == null) {
                dao.insert(
                    ScheduleEntity(
                        publicId = incoming.publicId,
                        name = incoming.name,
                        startDate = incoming.startDate,
                        endDate = incoming.endDate,
                        zoneId = incoming.zoneId,
                        revision = incoming.revision,
                        updatedAt = incoming.updatedAt,
                    ),
                )
            }
        }
    }

    private suspend fun applyPeriods(snapshot: ExchangeSnapshot, mode: ImportMode) {
        val dao = database.periodConfigDao()
        val oldByNumber = if (mode == ImportMode.MERGE) dao.getAll().associateBy { it.periodNumber } else emptyMap()
        val missing = snapshot.periodConfigs.filterNot { it.periodNumber in oldByNumber }
            .map { com.tangent.timetable.core.database.PeriodConfigEntity(it.periodNumber, it.startTime, it.endTime, it.label) }
        dao.insertAll(missing)
    }

    private suspend fun applyCourses(snapshot: ExchangeSnapshot) {
        val scheduleDao = database.scheduleDao()
        val courseDao = database.courseDao()
        snapshot.courses.forEach { incoming ->
            if (courseDao.findByPublicId(incoming.publicId) == null) {
                val schedule = scheduleDao.findByPublicId(incoming.schedulePublicId)
                    ?: throw IllegalArgumentException("课程引用的课表不存在")
                courseDao.insert(
                    CourseEntity(
                        publicId = incoming.publicId,
                        scheduleLocalId = schedule.localId,
                        name = incoming.name,
                        teacher = incoming.teacher,
                        location = incoming.location,
                        colorHex = incoming.colorHex,
                        note = incoming.note,
                        dayOfWeek = incoming.dayOfWeek,
                        startPeriod = incoming.startPeriod,
                        endPeriod = incoming.endPeriod,
                        weeks = incoming.weeks,
                        revision = incoming.revision,
                        updatedAt = incoming.updatedAt,
                    ),
                )
            }
        }
    }

    private suspend fun applyExams(snapshot: ExchangeSnapshot) {
        val scheduleDao = database.scheduleDao()
        val examDao = database.examDao()
        snapshot.exams.forEach { incoming ->
            if (examDao.findByPublicId(incoming.publicId) == null) {
                val schedule = scheduleDao.findByPublicId(incoming.schedulePublicId)
                    ?: throw IllegalArgumentException("考试引用的课表不存在")
                examDao.insert(
                    ExamEntity(
                        publicId = incoming.publicId,
                        scheduleLocalId = schedule.localId,
                        name = incoming.name,
                        location = incoming.location,
                        startAt = incoming.startAt,
                        endAt = incoming.endAt,
                        zoneId = incoming.zoneId,
                        revision = incoming.revision,
                        updatedAt = incoming.updatedAt,
                    ),
                )
            }
        }
    }

    private suspend fun applyTodos(snapshot: ExchangeSnapshot) {
        val todoDao = database.todoDao()
        val examDao = database.examDao()
        snapshot.todos.forEach { incoming ->
            if (todoDao.findByPublicId(incoming.publicId) == null) {
                val examLocalId = incoming.examPublicId?.let { publicId ->
                    examDao.findByPublicId(publicId)?.localId
                        ?: throw IllegalArgumentException("考试待办引用的考试不存在")
                }
                todoDao.insert(
                    TodoEntity(
                        publicId = incoming.publicId,
                        title = incoming.title,
                        details = incoming.details,
                        dueAt = incoming.dueAt,
                        zoneId = incoming.zoneId,
                        completed = incoming.completed,
                        completedAt = incoming.completedAt,
                        examLocalId = examLocalId,
                        revision = incoming.revision,
                        updatedAt = incoming.updatedAt,
                    ),
                )
            }
        }
    }

    private suspend fun TodoEntity.toExchangeTodo(database: TimetableDatabase) = ExchangeTodo(
        publicId = publicId,
        title = title,
        details = details,
        dueAt = dueAt,
        zoneId = zoneId,
        completed = completed,
        completedAt = completedAt,
        examPublicId = examLocalId?.let { database.examDao().findByLocalId(it)?.publicId },
        revision = revision,
        updatedAt = updatedAt,
    )

    private suspend fun readBounded(input: InputStream): String {
        input.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > ExchangeCodec.MAX_FILE_BYTES) {
                    throw IllegalArgumentException("交换文件超过 10 MB，未导入任何数据")
                }
                output.write(buffer, 0, read)
            }
            return output.toByteArray().toString(Charsets.UTF_8)
        }
    }

    private fun conflict(type: String, title: String): Nothing =
        throw IllegalArgumentException("合并时发现相同 publicId 的" + type + "内容不同：“" + title + "”。未写入任何数据。")

    private fun ScheduleEntity.toExchangeSchedule() = ExchangeSchedule(
        publicId = publicId,
        name = name,
        startDate = startDate,
        endDate = endDate,
        zoneId = zoneId,
        revision = revision,
        updatedAt = updatedAt,
    )

    private suspend fun CourseEntity.toExchangeCourse() =
        ExchangeCourse(
            publicId = publicId,
            schedulePublicId = database.scheduleDao().findByLocalId(scheduleLocalId)?.publicId
                ?: throw IllegalStateException("课程引用的课表不存在"),
            name = name,
            teacher = teacher,
            location = location,
            colorHex = colorHex,
            note = note,
            dayOfWeek = dayOfWeek,
            startPeriod = startPeriod,
            endPeriod = endPeriod,
            weeks = weeks,
            revision = revision,
            updatedAt = updatedAt,
        )

    private suspend fun ExamEntity.toExchangeExam() = ExchangeExam(
        publicId = publicId,
        schedulePublicId = database.scheduleDao().findByLocalId(scheduleLocalId)?.publicId
            ?: throw IllegalStateException("考试引用的课表不存在"),
        name = name,
        location = location,
        startAt = startAt,
        endAt = endAt,
        zoneId = zoneId,
        revision = revision,
        updatedAt = updatedAt,
    )
}
