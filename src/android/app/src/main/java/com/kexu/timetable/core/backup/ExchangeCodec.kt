package com.kexu.timetable.core.backup

import com.kexu.timetable.core.LegacyIdentifiers
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

object ExchangeCodec {
    const val FORMAT = "kexu-exchange"
    const val SCHEMA_VERSION = 1
    const val MAX_FILE_BYTES = 10 * 1024 * 1024
    private const val READER_VERSION = "1.0.0"

    fun encode(snapshot: ExchangeSnapshot): String {
        val payload = JSONObject()
            .put("schedules", JSONArray().apply { snapshot.schedules.forEach { put(it.toJson()) } })
            .put("periodConfigs", JSONArray().apply { snapshot.periodConfigs.forEach { put(it.toJson()) } })
            .put("courses", JSONArray().apply { snapshot.courses.forEach { put(it.toJson()) } })
            .put("exams", JSONArray().apply { snapshot.exams.forEach { put(it.toJson()) } })
            .put("todos", JSONArray().apply { snapshot.todos.forEach { put(it.toJson()) } })
            .put("recurringRules", JSONArray())
            .put("recurringOccurrences", JSONArray())
            .put("todoReminders", JSONArray())
            .put("examReminders", JSONArray())

        val encoded = JSONObject()
            .put("format", FORMAT)
            .put("schemaVersion", SCHEMA_VERSION)
            .put("sourceDatasetId", snapshot.sourceDatasetId)
            .put("exportedAt", Instant.now().toString())
            .put("minimumReaderVersion", READER_VERSION)
            .put("payload", payload)
            .toString(2)
        if (encoded.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) fail("导出文件超过 10 MB，请拆分数据后重试")
        return encoded
    }

    fun decode(text: String): ExchangeSnapshot {
        if (text.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) {
            fail("交换文件超过 10 MB，未导入任何数据")
        }
        val root = try {
            JSONObject(text)
        } catch (_: Exception) {
            fail("文件不是有效的 JSON")
        }
        root.requireKeys(
            setOf("format", "schemaVersion", "sourceDatasetId", "exportedAt", "minimumReaderVersion", "payload"),
            "文件头",
        )
        if (root.requiredString("format", "文件头") !in setOf(FORMAT, LegacyIdentifiers.EXCHANGE_FORMAT)) fail("文件类型不匹配")
        if (root.requiredInt("schemaVersion", "文件头") != SCHEMA_VERSION) fail("不支持此交换文件版本")
        val sourceDatasetId = root.requiredString("sourceDatasetId", "文件头").also(::requireUuid)
        parseInstant(root.requiredString("exportedAt", "文件头"), "导出时间")
        val minimumReaderVersion = root.requiredString("minimumReaderVersion", "文件头")
        if (compareVersions(minimumReaderVersion, READER_VERSION) > 0) {
            fail("此文件至少需要读取器 " + minimumReaderVersion + "，当前应用为 " + READER_VERSION)
        }

        val payload = root.requiredObject("payload", "文件头")
        payload.requireKeys(
            setOf(
                "schedules",
                "periodConfigs",
                "courses",
                "exams",
                "todos",
                "recurringRules",
                "recurringOccurrences",
                "todoReminders",
                "examReminders",
            ),
            "payload",
        )
        listOf("recurringRules", "recurringOccurrences", "todoReminders", "examReminders").forEach { key ->
            if (payload.requiredArray(key, "payload").length() > 0) {
                fail("文件包含" + key + "记录；此 Android 首版尚未接入循环规则和提醒导入，未写入任何数据")
            }
        }

        val snapshot = ExchangeSnapshot(
            sourceDatasetId = sourceDatasetId,
            schedules = payload.requiredArray("schedules", "payload").toObjectList("schedules", ExchangeCodec::parseSchedule),
            periodConfigs = payload.requiredArray("periodConfigs", "payload").toObjectList("periodConfigs", ExchangeCodec::parsePeriodConfig),
            courses = payload.requiredArray("courses", "payload").toObjectList("courses", ExchangeCodec::parseCourse),
            exams = payload.requiredArray("exams", "payload").toObjectList("exams", ExchangeCodec::parseExam),
            todos = payload.requiredArray("todos", "payload").toObjectList("todos", ExchangeCodec::parseTodo),
        )
        validate(snapshot)
        return snapshot
    }

    private fun validate(snapshot: ExchangeSnapshot) {
        snapshot.schedules.uniqueIds("schedules") { it.publicId }
        snapshot.courses.uniqueIds("courses") { it.publicId }
        snapshot.exams.uniqueIds("exams") { it.publicId }
        snapshot.todos.uniqueIds("todos") { it.publicId }
        snapshot.periodConfigs.groupBy { it.periodNumber }.filterValues { it.size > 1 }.keys.firstOrNull()?.let {
            fail("节次 " + it + " 重复")
        }
        if (snapshot.periodConfigs.isEmpty()) fail("交换文件缺少作息节次")
        snapshot.periodConfigs.forEach { period ->
            if (period.periodNumber < 1) fail("节次必须从 1 开始")
            if (parseTime(period.startTime, "第 " + period.periodNumber + " 节开始时间") >=
                parseTime(period.endTime, "第 " + period.periodNumber + " 节结束时间")
            ) {
                fail("第 " + period.periodNumber + " 节的结束时间必须晚于开始时间")
            }
        }

        val scheduleById = snapshot.schedules.associateBy { it.publicId }
        snapshot.schedules.forEach { schedule ->
            requireUuid(schedule.publicId)
            if (schedule.name.isBlank()) fail("课表名称不能为空")
            val start = parseDate(schedule.startDate, "课表开始日期")
            val end = parseDate(schedule.endDate, "课表结束日期")
            if (end.isBefore(start)) fail("课表结束日期早于开始日期")
            parseZone(schedule.zoneId, "课表时区")
            if (schedule.revision < 1) fail("课表 revision 必须为正数")
            parseInstant(schedule.updatedAt, "课表更新时间")
        }
        val examById = snapshot.exams.associateBy { it.publicId }
        snapshot.courses.forEach { course ->
            requireUuid(course.publicId)
            if (course.schedulePublicId !in scheduleById) fail("课程引用了不存在的课表")
            if (course.name.isBlank()) fail("课程名称不能为空")
            if (course.dayOfWeek !in 1..7) fail("课程星期必须为 1 到 7")
            if (course.startPeriod < 1 || course.endPeriod < course.startPeriod) fail("课程节次范围无效")
            if (course.endPeriod > snapshot.periodConfigs.maxOf { it.periodNumber }) fail("课程节次超过作息配置范围")
            if (course.weeks.isEmpty() || course.weeks.distinct().size != course.weeks.size) fail("课程教学周为空或重复")
            val schedule = scheduleById.getValue(course.schedulePublicId)
            val totalWeeks = com.kexu.timetable.core.time.TermWeekCalculator.totalWeeks(
                LocalDate.parse(schedule.startDate),
                LocalDate.parse(schedule.endDate),
            )
            if (course.weeks.any { it !in 1..totalWeeks }) fail("课程周次超出学期范围")
            if (!Regex("^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$").matches(course.colorHex)) {
                fail("课程颜色必须是 #RRGGBB 或 #AARRGGBB")
            }
            if (course.revision < 1) fail("课程 revision 必须为正数")
            parseInstant(course.updatedAt, "课程更新时间")
        }
        snapshot.courses.groupBy { it.schedulePublicId }.forEach { (_, courses) ->
            val accepted = mutableListOf<com.kexu.timetable.core.domain.CourseSlot>()
            courses.forEach { course ->
                val slot = com.kexu.timetable.core.domain.CourseSlot(
                    course.publicId,
                    course.dayOfWeek,
                    course.startPeriod,
                    course.endPeriod,
                    course.weeks.toSet(),
                )
                if (com.kexu.timetable.core.domain.CourseRules.findConflict(slot, accepted) != null) {
                    fail("交换文件内存在课程时间冲突")
                }
                accepted += slot
            }
        }
        snapshot.exams.forEach { exam ->
            requireUuid(exam.publicId)
            if (exam.schedulePublicId !in scheduleById) fail("考试引用了不存在的课表")
            if (exam.name.isBlank()) fail("考试名称不能为空")
            val start = parseDateTime(exam.startAt, "考试开始时间")
            val end = parseDateTime(exam.endAt, "考试结束时间")
            if (!end.isAfter(start)) fail("考试结束时间必须晚于开始时间")
            parseZone(exam.zoneId, "考试时区")
            if (exam.revision < 1) fail("考试 revision 必须为正数")
            parseInstant(exam.updatedAt, "考试更新时间")
        }
        val usedExamIds = mutableSetOf<String>()
        snapshot.todos.forEach { todo ->
            requireUuid(todo.publicId)
            if (todo.title.isBlank()) fail("待办标题不能为空")
            todo.dueAt?.let { parseDateTime(it, "待办截止时间") }
            todo.completedAt?.let { parseInstant(it, "待办完成时间") }
            parseZone(todo.zoneId, "待办时区")
            todo.examPublicId?.let { examId ->
                requireUuid(examId)
                if (examId !in examById) fail("考试关联待办引用了不存在的考试")
                if (!usedExamIds.add(examId)) fail("一场考试关联了多条待办")
            }
            if (todo.revision < 1) fail("待办 revision 必须为正数")
            parseInstant(todo.updatedAt, "待办更新时间")
        }
        val examsWithoutTodos = examById.keys - usedExamIds
        if (examsWithoutTodos.isNotEmpty()) fail("每场考试必须包含且只包含一条关联待办")
    }

    private fun parseSchedule(json: JSONObject, path: String) = ExchangeSchedule(
        publicId = json.requiredString("publicId", path).also(::requireUuid),
        name = json.requiredString("name", path),
        startDate = json.requiredString("startDate", path),
        endDate = json.requiredString("endDate", path),
        zoneId = json.requiredString("zoneId", path),
        revision = json.requiredLong("revision", path),
        updatedAt = json.requiredString("updatedAt", path),
    ).also { json.requireKeys(setOf("publicId", "name", "startDate", "endDate", "zoneId", "revision", "updatedAt"), path) }

    private fun parsePeriodConfig(json: JSONObject, path: String) = ExchangePeriodConfig(
        periodNumber = json.requiredInt("periodNumber", path),
        startTime = json.requiredString("startTime", path),
        endTime = json.requiredString("endTime", path),
        label = json.requiredString("label", path),
    ).also { json.requireKeys(setOf("periodNumber", "startTime", "endTime", "label"), path) }

    private fun parseCourse(json: JSONObject, path: String) = ExchangeCourse(
        publicId = json.requiredString("publicId", path).also(::requireUuid),
        schedulePublicId = json.requiredString("schedulePublicId", path).also(::requireUuid),
        name = json.requiredString("name", path),
        teacher = json.requiredString("teacher", path),
        location = json.requiredString("location", path),
        colorHex = json.requiredString("colorHex", path),
        note = json.requiredString("note", path),
        dayOfWeek = json.requiredInt("dayOfWeek", path),
        startPeriod = json.requiredInt("startPeriod", path),
        endPeriod = json.requiredInt("endPeriod", path),
        weeks = json.requiredArray("weeks", path).toIntList(path + ".weeks"),
        revision = json.requiredLong("revision", path),
        updatedAt = json.requiredString("updatedAt", path),
    ).also {
        json.requireKeys(
            setOf("publicId", "schedulePublicId", "name", "teacher", "location", "colorHex", "note", "dayOfWeek", "startPeriod", "endPeriod", "weeks", "revision", "updatedAt"),
            path,
        )
    }

    private fun parseExam(json: JSONObject, path: String) = ExchangeExam(
        publicId = json.requiredString("publicId", path).also(::requireUuid),
        schedulePublicId = json.requiredString("schedulePublicId", path).also(::requireUuid),
        name = json.requiredString("name", path),
        location = json.requiredString("location", path),
        startAt = json.requiredString("startAt", path),
        endAt = json.requiredString("endAt", path),
        zoneId = json.requiredString("zoneId", path),
        revision = json.requiredLong("revision", path),
        updatedAt = json.requiredString("updatedAt", path),
    ).also { json.requireKeys(setOf("publicId", "schedulePublicId", "name", "location", "startAt", "endAt", "zoneId", "revision", "updatedAt"), path) }

    private fun parseTodo(json: JSONObject, path: String) = ExchangeTodo(
        publicId = json.requiredString("publicId", path).also(::requireUuid),
        title = json.requiredString("title", path),
        details = json.requiredString("details", path),
        dueAt = json.nullableString("dueAt", path),
        zoneId = json.requiredString("zoneId", path),
        completed = json.requiredBoolean("completed", path),
        completedAt = json.nullableString("completedAt", path),
        examPublicId = json.nullableString("examPublicId", path),
        revision = json.requiredLong("revision", path),
        updatedAt = json.requiredString("updatedAt", path),
    ).also {
        json.requireKeys(
            setOf("publicId", "title", "details", "dueAt", "zoneId", "completed", "completedAt", "examPublicId", "revision", "updatedAt"),
            path,
        )
    }

    private fun ExchangeSchedule.toJson() = JSONObject()
        .put("publicId", publicId).put("name", name).put("startDate", startDate).put("endDate", endDate)
        .put("zoneId", zoneId).put("revision", revision).put("updatedAt", updatedAt)

    private fun ExchangePeriodConfig.toJson() = JSONObject()
        .put("periodNumber", periodNumber).put("startTime", startTime).put("endTime", endTime).put("label", label)

    private fun ExchangeCourse.toJson() = JSONObject()
        .put("publicId", publicId).put("schedulePublicId", schedulePublicId).put("name", name)
        .put("teacher", teacher).put("location", location).put("colorHex", colorHex).put("note", note)
        .put("dayOfWeek", dayOfWeek).put("startPeriod", startPeriod).put("endPeriod", endPeriod)
        .put("weeks", JSONArray(weeks)).put("revision", revision).put("updatedAt", updatedAt)

    private fun ExchangeExam.toJson() = JSONObject()
        .put("publicId", publicId).put("schedulePublicId", schedulePublicId).put("name", name)
        .put("location", location).put("startAt", startAt).put("endAt", endAt).put("zoneId", zoneId)
        .put("revision", revision).put("updatedAt", updatedAt)

    private fun ExchangeTodo.toJson() = JSONObject()
        .put("publicId", publicId).put("title", title).put("details", details)
        .put("dueAt", dueAt ?: JSONObject.NULL).put("zoneId", zoneId).put("completed", completed)
        .put("completedAt", completedAt ?: JSONObject.NULL).put("examPublicId", examPublicId ?: JSONObject.NULL)
        .put("revision", revision).put("updatedAt", updatedAt)

    private fun JSONObject.requireKeys(expected: Set<String>, path: String) {
        val actual = keys().asSequence().toSet()
        val missing = expected - actual
        val unknown = actual - expected
        if (missing.isNotEmpty()) fail(path + "缺少字段：" + missing.sorted().joinToString())
        if (unknown.isNotEmpty()) fail(path + "包含当前版本无法识别的字段：" + unknown.sorted().joinToString())
    }

    private fun JSONObject.requiredString(key: String, path: String): String =
        (opt(key) as? String) ?: fail(path + "." + key + "必须是字符串")

    private fun JSONObject.nullableString(key: String, path: String): String? {
        if (!has(key)) fail(path + "缺少字段：" + key)
        if (isNull(key)) return null
        return opt(key) as? String ?: fail(path + "." + key + "必须是字符串或 null")
    }

    private fun JSONObject.requiredInt(key: String, path: String): Int {
        val number = opt(key) as? Number ?: fail(path + "." + key + "必须是整数")
        val asLong = number.toLong()
        if (number.toDouble() != asLong.toDouble() || asLong !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
            fail(path + "." + key + "必须是整数")
        }
        return asLong.toInt()
    }

    private fun JSONObject.requiredLong(key: String, path: String): Long {
        val number = opt(key) as? Number ?: fail(path + "." + key + "必须是整数")
        val value = number.toLong()
        if (number.toDouble() != value.toDouble()) fail(path + "." + key + "必须是整数")
        return value
    }

    private fun JSONObject.requiredBoolean(key: String, path: String): Boolean =
        opt(key) as? Boolean ?: fail(path + "." + key + "必须是布尔值")

    private fun JSONObject.requiredObject(key: String, path: String): JSONObject =
        opt(key) as? JSONObject ?: fail(path + "." + key + "必须是对象")

    private fun JSONObject.requiredArray(key: String, path: String): JSONArray =
        opt(key) as? JSONArray ?: fail(path + "." + key + "必须是数组")

    private inline fun <reified T> JSONArray.toObjectList(
        path: String,
        crossinline parse: (JSONObject, String) -> T,
    ): List<T> =
        List(length()) { index ->
            val item = opt(index) as? JSONObject ?: fail(path + "[" + index + "]必须是对象")
            parse(item, path + "[" + index + "]")
        }

    private fun JSONArray.toIntList(path: String): List<Int> =
        List(length()) { index ->
            val value = opt(index) as? Number ?: fail(path + "[" + index + "]必须是整数")
            val longValue = value.toLong()
            if (value.toDouble() != longValue.toDouble() || longValue !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
                fail(path + "[" + index + "]必须是整数")
            }
            longValue.toInt()
        }

    private fun <T> Iterable<T>.uniqueIds(label: String, id: (T) -> String) {
        val seen = mutableSetOf<String>()
        forEach { item ->
            val publicId = id(item)
            requireUuid(publicId)
            if (!seen.add(publicId)) fail(label + "中 publicId 重复：" + publicId)
        }
    }

    private fun requireUuid(value: String) {
        val parsed = runCatching { UUID.fromString(value) }.getOrElse { fail("UUID 格式无效：" + value) }
        if (parsed.toString() != value) fail("UUID 必须使用标准小写格式：" + value)
    }

    private fun parseDate(value: String, label: String): LocalDate =
        runCatching { LocalDate.parse(value) }.getOrElse { fail(label + "格式无效") }

    private fun parseDateTime(value: String, label: String): LocalDateTime =
        runCatching { LocalDateTime.parse(value) }.getOrElse { fail(label + "格式无效") }

    private fun parseTime(value: String, label: String): LocalTime =
        runCatching { LocalTime.parse(value) }.getOrElse { fail(label + "格式无效") }

    private fun parseZone(value: String, label: String) {
        runCatching { ZoneId.of(value) }.getOrElse { fail(label + "格式无效") }
    }

    private fun parseInstant(value: String, label: String) {
        runCatching { Instant.parse(value) }.getOrElse { fail(label + "格式无效") }
    }

    private fun compareVersions(left: String, right: String): Int {
        fun parts(value: String): List<Int> {
            val split = value.split('.')
            if (split.size != 3 || split.any { it.toIntOrNull() == null }) fail("最低读取器版本格式无效")
            return split.map(String::toInt)
        }
        val a = parts(left)
        val b = parts(right)
        for (index in 0..2) {
            if (a[index] != b[index]) return a[index].compareTo(b[index])
        }
        return 0
    }

    private fun fail(message: String): Nothing = throw IllegalArgumentException(message)
}
