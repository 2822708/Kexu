package com.tangent.timetable.core.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase
import java.time.Instant
import java.util.UUID

@Database(
    entities = [
        AppMetadataEntity::class,
        ScheduleEntity::class,
        PeriodConfigEntity::class,
        CourseEntity::class,
        ExamEntity::class,
        TodoEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(DatabaseConverters::class)
abstract class TimetableDatabase : RoomDatabase() {
    abstract fun scheduleDao(): ScheduleDao
    abstract fun periodConfigDao(): PeriodConfigDao
    abstract fun courseDao(): CourseDao
    abstract fun examDao(): ExamDao
    abstract fun todoDao(): TodoDao
    abstract fun appMetadataDao(): AppMetadataDao

    companion object {
        private const val DATABASE_NAME = "tangent-timetable.db"

        @Volatile
        private var instance: TimetableDatabase? = null

        fun getInstance(context: Context): TimetableDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    TimetableDatabase::class.java,
                    DATABASE_NAME,
                )
                    .addCallback(SeedCallback())
                    .build()
                    .also { instance = it }
            }

        private class SeedCallback : Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                super.onCreate(db)
                db.execSQL(
                    "INSERT OR IGNORE INTO app_metadata (id, sourceDatasetId, createdAt) VALUES (1, ?, ?)",
                    arrayOf(UUID.randomUUID().toString(), Instant.now().toString()),
                )
                defaultPeriods().forEach { period ->
                    db.execSQL(
                        "INSERT OR IGNORE INTO period_configs (periodNumber, startTime, endTime, label) VALUES (?, ?, ?, ?)",
                        arrayOf(period.periodNumber, period.startTime, period.endTime, period.label),
                    )
                }
            }
        }

        private fun defaultPeriods(): List<PeriodConfigEntity> {
            val times = listOf(
                "08:00" to "08:45",
                "08:55" to "09:40",
                "10:00" to "10:45",
                "10:55" to "11:40",
                "13:30" to "14:15",
                "14:25" to "15:10",
                "15:30" to "16:15",
                "16:25" to "17:10",
                "18:30" to "19:15",
                "19:25" to "20:10",
                "20:20" to "21:05",
                "21:15" to "22:00",
            )
            return times.mapIndexed { index, time ->
                PeriodConfigEntity(index + 1, time.first, time.second, "第" + (index + 1) + "节")
            }
        }
    }
}
