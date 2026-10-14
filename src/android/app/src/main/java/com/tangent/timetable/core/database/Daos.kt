package com.tangent.timetable.core.database

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ScheduleDao {
    @Query("SELECT * FROM schedules ORDER BY localId")
    fun observeAll(): Flow<List<ScheduleEntity>>

    @Query("SELECT * FROM schedules ORDER BY localId")
    suspend fun getAll(): List<ScheduleEntity>

    @Query("SELECT * FROM schedules WHERE localId = :localId LIMIT 1")
    suspend fun findByLocalId(localId: Long): ScheduleEntity?

    @Query("SELECT * FROM schedules WHERE publicId = :publicId LIMIT 1")
    suspend fun findByPublicId(publicId: String): ScheduleEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(schedule: ScheduleEntity): Long

    @Update
    suspend fun update(schedule: ScheduleEntity)

    @Query("DELETE FROM schedules")
    suspend fun deleteAll()
}

@Dao
interface PeriodConfigDao {
    @Query("SELECT * FROM period_configs ORDER BY periodNumber")
    fun observeAll(): Flow<List<PeriodConfigEntity>>

    @Query("SELECT * FROM period_configs ORDER BY periodNumber")
    suspend fun getAll(): List<PeriodConfigEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(configs: List<PeriodConfigEntity>)

    @Query("DELETE FROM period_configs")
    suspend fun deleteAll()
}

@Dao
interface CourseDao {
    @Query("SELECT * FROM courses WHERE scheduleLocalId = :scheduleId AND dayOfWeek = :dayOfWeek ORDER BY startPeriod, endPeriod")
    fun observeDay(scheduleId: Long, dayOfWeek: Int): Flow<List<CourseEntity>>

    @Query("SELECT * FROM courses WHERE scheduleLocalId = :scheduleId ORDER BY dayOfWeek, startPeriod")
    suspend fun getForSchedule(scheduleId: Long): List<CourseEntity>

    @Query("SELECT * FROM courses WHERE publicId = :publicId LIMIT 1")
    suspend fun findByPublicId(publicId: String): CourseEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(course: CourseEntity): Long

    @Update
    suspend fun update(course: CourseEntity)

    @Query("DELETE FROM courses WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: Long)
}

@Dao
interface ExamDao {
    @Query("SELECT * FROM exams WHERE scheduleLocalId = :scheduleId ORDER BY startAt")
    fun observeForSchedule(scheduleId: Long): Flow<List<ExamEntity>>

    @Query("SELECT * FROM exams WHERE scheduleLocalId = :scheduleId ORDER BY startAt")
    suspend fun getForSchedule(scheduleId: Long): List<ExamEntity>

    @Query("SELECT * FROM exams")
    suspend fun getAll(): List<ExamEntity>

    @Query("SELECT * FROM exams WHERE publicId = :publicId LIMIT 1")
    suspend fun findByPublicId(publicId: String): ExamEntity?

    @Query("SELECT * FROM exams WHERE localId = :localId LIMIT 1")
    suspend fun findByLocalId(localId: Long): ExamEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(exam: ExamEntity): Long

    @Update
    suspend fun update(exam: ExamEntity)

    @Query("DELETE FROM exams WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: Long)

    @Query("DELETE FROM exams")
    suspend fun deleteAll()
}

@Dao
interface TodoDao {
    @Query("SELECT * FROM todos ORDER BY completed, CASE WHEN dueAt IS NULL THEN 1 ELSE 0 END, dueAt, localId")
    fun observeAll(): Flow<List<TodoEntity>>

    @Query("SELECT * FROM todos WHERE examLocalId = :examLocalId LIMIT 1")
    suspend fun findForExam(examLocalId: Long): TodoEntity?

    @Query("SELECT * FROM todos WHERE publicId = :publicId LIMIT 1")
    suspend fun findByPublicId(publicId: String): TodoEntity?

    @Query("SELECT * FROM todos WHERE localId = :localId LIMIT 1")
    suspend fun findByLocalId(localId: Long): TodoEntity?

    @Query("SELECT * FROM todos ORDER BY localId")
    suspend fun getAll(): List<TodoEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(todo: TodoEntity): Long

    @Update
    suspend fun update(todo: TodoEntity)

    @Query("DELETE FROM todos WHERE localId = :localId AND examLocalId IS NULL")
    suspend fun deleteStandaloneByLocalId(localId: Long)

    @Query("DELETE FROM todos")
    suspend fun deleteAll()
}

@Dao
interface AppMetadataDao {
    @Query("SELECT * FROM app_metadata WHERE id = 1 LIMIT 1")
    suspend fun get(): AppMetadataEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(metadata: AppMetadataEntity)
}
