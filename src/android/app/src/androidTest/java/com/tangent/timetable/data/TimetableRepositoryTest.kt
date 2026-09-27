package com.tangent.timetable.data

import android.content.Context
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tangent.timetable.core.database.CourseEntity
import com.tangent.timetable.core.database.ExamEntity
import com.tangent.timetable.core.database.PeriodConfigEntity
import com.tangent.timetable.core.database.ScheduleEntity
import com.tangent.timetable.core.database.TimetableDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.time.ZoneId
import java.time.LocalDateTime
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class TimetableRepositoryTest {
    private lateinit var database: TimetableDatabase
    private lateinit var repository: TimetableRepository
    private var scheduleId: Long = 0

    @Before
    fun createDatabase() = runBlocking {
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        database = Room.inMemoryDatabaseBuilder(context, TimetableDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = TimetableRepository(database)
        database.periodConfigDao().insertAll(
            listOf(
                PeriodConfigEntity(1, "08:00", "08:45", "第1节"),
                PeriodConfigEntity(2, "08:55", "09:40", "第2节"),
                PeriodConfigEntity(3, "10:00", "10:45", "第3节"),
            ),
        )
        scheduleId = database.scheduleDao().insert(
            ScheduleEntity(
                name = "测试学期",
                startDate = "2026-09-23",
                endDate = "2027-01-06",
                zoneId = "Asia/Shanghai",
            ),
        )
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun savingAndDeletingExamKeepsGeneratedTodoInSync() = runBlocking {
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
        val savedExam = database.examDao().getForSchedule(scheduleId).single()
        val attachedTodo = database.todoDao().findForExam(savedExam.localId)
        assertEquals("考试：离散数学", attachedTodo?.title)
        assertEquals(savedExam.startAt, attachedTodo?.dueAt)

        repository.deleteExam(savedExam.localId)

        assertEquals(0, database.examDao().getForSchedule(scheduleId).size)
        assertEquals(0, database.todoDao().getAll().size)
    }

    @Test
    fun overlappingCoursesInTheSameTeachingWeeksAreRejected() = runBlocking {
        val first = CourseEntity(
            scheduleLocalId = scheduleId,
            name = "高等数学",
            teacher = "",
            location = "",
            colorHex = "#658C73",
            note = "",
            dayOfWeek = 1,
            startPeriod = 1,
            endPeriod = 2,
            weeks = listOf(1, 2, 3),
        )
        repository.saveCourse(first)
        val conflict = first.copy(
            localId = 0,
            publicId = UUID.randomUUID().toString(),
            name = "线性代数",
            startPeriod = 2,
            endPeriod = 3,
            weeks = listOf(3, 4),
        )

        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.saveCourse(conflict) }
        }
        assertEquals(1, database.courseDao().getForSchedule(scheduleId).size)
    }

    @Test
    fun pastExamIsReconciledToCompletedWhenRepositoryRuns() = runBlocking {
        val start = LocalDateTime.now().minusHours(2).withSecond(0).withNano(0)
        val end = start.plusHours(1)
        repository.saveExam(
            ExamEntity(
                scheduleLocalId = scheduleId,
                name = "已结束的考试",
                location = "",
                startAt = start.toString(),
                endAt = end.toString(),
                zoneId = ZoneId.systemDefault().id,
            ),
        )
        val savedExam = database.examDao().getForSchedule(scheduleId).single()

        repository.reconcilePastExamTodos()

        assertEquals(true, database.todoDao().findForExam(savedExam.localId)?.completed)
    }
}
