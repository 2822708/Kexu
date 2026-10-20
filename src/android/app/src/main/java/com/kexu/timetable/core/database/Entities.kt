package com.kexu.timetable.core.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import org.json.JSONArray
import java.time.Instant
import java.util.UUID

@Entity(tableName = "app_metadata")
data class AppMetadataEntity(
    @PrimaryKey val id: Int = 1,
    val sourceDatasetId: String = UUID.randomUUID().toString(),
    val createdAt: String = Instant.now().toString(),
)

@Entity(
    tableName = "schedules",
    indices = [Index(value = ["publicId"], unique = true)],
)
data class ScheduleEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val publicId: String = UUID.randomUUID().toString(),
    val name: String,
    val startDate: String,
    val endDate: String,
    val zoneId: String,
    val revision: Long = 1,
    val updatedAt: String = Instant.now().toString(),
)

@Entity(tableName = "period_configs")
data class PeriodConfigEntity(
    @PrimaryKey val periodNumber: Int,
    val startTime: String,
    val endTime: String,
    val label: String,
)

@Entity(
    tableName = "courses",
    foreignKeys = [
        ForeignKey(
            entity = ScheduleEntity::class,
            parentColumns = ["localId"],
            childColumns = ["scheduleLocalId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["publicId"], unique = true),
        Index(value = ["scheduleLocalId", "dayOfWeek"]),
    ],
)
data class CourseEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val publicId: String = UUID.randomUUID().toString(),
    val scheduleLocalId: Long,
    val name: String,
    val teacher: String,
    val location: String,
    val colorHex: String,
    val note: String,
    val dayOfWeek: Int,
    val startPeriod: Int,
    val endPeriod: Int,
    val weeks: List<Int>,
    val revision: Long = 1,
    val updatedAt: String = Instant.now().toString(),
)

@Entity(
    tableName = "exams",
    foreignKeys = [
        ForeignKey(
            entity = ScheduleEntity::class,
            parentColumns = ["localId"],
            childColumns = ["scheduleLocalId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["publicId"], unique = true),
        Index(value = ["scheduleLocalId", "startAt"]),
    ],
)
data class ExamEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val publicId: String = UUID.randomUUID().toString(),
    val scheduleLocalId: Long,
    val name: String,
    val location: String,
    val startAt: String,
    val endAt: String,
    val zoneId: String,
    val revision: Long = 1,
    val updatedAt: String = Instant.now().toString(),
)

@Entity(
    tableName = "todos",
    foreignKeys = [
        ForeignKey(
            entity = ExamEntity::class,
            parentColumns = ["localId"],
            childColumns = ["examLocalId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["publicId"], unique = true),
        Index(value = ["completed", "dueAt"]),
        Index(value = ["examLocalId"], unique = true),
    ],
)
data class TodoEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val publicId: String = UUID.randomUUID().toString(),
    val title: String,
    val details: String,
    val dueAt: String?,
    val zoneId: String,
    val completed: Boolean = false,
    val completedAt: String? = null,
    val examLocalId: Long? = null,
    val revision: Long = 1,
    val updatedAt: String = Instant.now().toString(),
)

class DatabaseConverters {
    @TypeConverter
    fun intListToJson(value: List<Int>): String = JSONArray(value).toString()

    @TypeConverter
    fun jsonToIntList(value: String): List<Int> {
        val array = JSONArray(value)
        return List(array.length()) { index -> array.getInt(index) }
    }
}
