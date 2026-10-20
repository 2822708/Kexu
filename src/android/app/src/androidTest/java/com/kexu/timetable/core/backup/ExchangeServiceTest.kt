package com.kexu.timetable.core.backup

import android.content.Context
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.kexu.timetable.core.database.AppMetadataEntity
import com.kexu.timetable.core.database.CourseEntity
import com.kexu.timetable.core.database.ExamEntity
import com.kexu.timetable.core.database.PeriodConfigEntity
import com.kexu.timetable.core.database.TimetableDatabase
import com.kexu.timetable.data.TimetableRepository
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.time.ZoneId

@RunWith(AndroidJUnit4::class)
class ExchangeServiceTest {
    private lateinit var database: TimetableDatabase
    private lateinit var repository: TimetableRepository

    @Before
    fun createDatabase() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        database = Room.inMemoryDatabaseBuilder(context, TimetableDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = TimetableRepository(database)
        database.appMetadataDao().insert(AppMetadataEntity())
        database.periodConfigDao().insertAll(
            listOf(
                PeriodConfigEntity(1, "08:00", "08:45", "第1节"),
                PeriodConfigEntity(2, "08:55", "09:40", "第2节"),
            ),
        )
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun exportedFileRestoresCoursesExamsAndBothTodoKinds() = runBlocking {
        val scheduleId = repository.createSchedule(
            name = "测试学期",
            startDateText = "2026-09-23",
            endDateText = "2027-01-06",
            zoneIdText = "Asia/Shanghai",
        )
        repository.saveCourse(
            CourseEntity(
                scheduleLocalId = scheduleId,
                name = "高等数学",
                teacher = "张老师",
                location = "教 101",
                colorHex = "#658C73",
                note = "",
                dayOfWeek = 3,
                startPeriod = 1,
                endPeriod = 2,
                weeks = listOf(1, 3, 5),
            ),
        )
        repository.saveExam(
            ExamEntity(
                scheduleLocalId = scheduleId,
                name = "离散数学",
                location = "东 201",
                startAt = "2026-12-20T09:00",
                endAt = "2026-12-20T11:00",
                zoneId = ZoneId.of("Asia/Shanghai").id,
            ),
        )
        repository.addTodo("交课程报告", "本地待办", "2026-12-01T18:00", "Asia/Shanghai")
        val originalDatasetId = database.appMetadataDao().get()?.sourceDatasetId
        val service = ExchangeService(database)
        val json = service.exportJson()

        val preview = service.previewImport(ByteArrayInputStream(json.toByteArray(Charsets.UTF_8)))
        assertEquals(1, preview.schedules)
        assertEquals(1, preview.courses)
        assertEquals(1, preview.exams)
        assertEquals(2, preview.todos)

        service.applyPendingImport(ImportMode.REPLACE)

        assertEquals(1, database.scheduleDao().getAll().size)
        assertEquals(1, database.courseDao().getForSchedule(scheduleId = database.scheduleDao().getAll().single().localId).size)
        assertEquals(1, database.examDao().getForSchedule(database.scheduleDao().getAll().single().localId).size)
        val restoredTodos = database.todoDao().getAll()
        assertEquals(2, restoredTodos.size)
        assertEquals(1, restoredTodos.count { it.examLocalId != null })
        assertNotNull(restoredTodos.single { it.examLocalId != null }.dueAt)
        assertEquals(originalDatasetId, database.appMetadataDao().get()?.sourceDatasetId)
    }
}
