package com.kexu.timetable

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.kexu.timetable.core.backup.ExchangeImportSummary
import com.kexu.timetable.core.backup.ExchangeService
import com.kexu.timetable.core.backup.ImportMode
import com.kexu.timetable.core.database.CourseEntity
import com.kexu.timetable.core.database.ExamEntity
import com.kexu.timetable.core.database.ScheduleEntity
import com.kexu.timetable.core.database.TodoEntity
import com.kexu.timetable.core.preferences.AppPreferencesRepository
import com.kexu.timetable.data.TimetableRepository
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel(
    private val repository: TimetableRepository,
    private val preferences: AppPreferencesRepository,
) : ViewModel() {
    private val exchangeService = ExchangeService(repository.database)
    val schedules = repository.observeSchedules()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val periods = repository.observePeriods()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val todos = repository.observeTodos()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val preferredSchedulePublicId = preferences.activeSchedulePublicId
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val activeSchedule: StateFlow<ScheduleEntity?> = combine(schedules, preferredSchedulePublicId) { all, selected ->
        all.firstOrNull { it.publicId == selected } ?: all.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val selectedDay = MutableStateFlow(LocalDate.now().dayOfWeek.value)
    private val selectedWeek = MutableStateFlow(1)
    val selectedDayNumber: StateFlow<Int> = selectedDay.asStateFlow()
    val selectedWeekNumber: StateFlow<Int> = selectedWeek.asStateFlow()

    val courses: StateFlow<List<CourseEntity>> = combine(activeSchedule, selectedDay, selectedWeek) { schedule, day, week ->
        Triple(schedule, day, week)
    }.flatMapLatest { (schedule, day, week) ->
        if (schedule == null) flowOf(emptyList())
        else repository.observeCourses(schedule.localId, day, week)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val exams: StateFlow<List<ExamEntity>> = activeSchedule.flatMapLatest { schedule ->
        if (schedule == null) flowOf(emptyList())
        else repository.observeExams(schedule.localId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val mutableMessages = MutableSharedFlow<String>(extraBufferCapacity = 12)
    val messages = mutableMessages.asSharedFlow()

    fun setSelectedDay(day: Int) {
        if (day in 1..7) selectedDay.value = day
    }

    fun setSelectedWeek(week: Int) {
        if (week >= 1) selectedWeek.value = week
    }

    fun selectSchedule(schedule: ScheduleEntity) {
        viewModelScope.launch { preferences.setActiveSchedule(schedule.publicId) }
    }

    suspend fun createSchedule(name: String, startDate: String, endDate: String): String? =
        try {
            val id = repository.createSchedule(name, startDate, endDate, ZoneId.systemDefault().id)
            repository.findSchedule(id)?.let { preferences.setActiveSchedule(it.publicId) }
            null
        } catch (error: Exception) {
            error.message ?: "创建课表失败"
        }

    suspend fun saveCourse(course: CourseEntity): String? =
        try {
            repository.saveCourse(course)
            null
        } catch (error: Exception) {
            error.message ?: "保存课程失败"
        }

    suspend fun saveExam(exam: ExamEntity): String? =
        try {
            repository.saveExam(exam)
            null
        } catch (error: Exception) {
            error.message ?: "保存考试失败"
        }

    suspend fun exportExchangeFile(resolver: ContentResolver, uri: Uri): String =
        withContext(Dispatchers.IO) {
            try {
                val json = exchangeService.exportJson()
                val output = resolver.openOutputStream(uri, "w")
                    ?: throw IllegalStateException("无法写入所选文件")
                output.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                "交换文件已导出（" + json.toByteArray(Charsets.UTF_8).size + " 字节）"
            } catch (error: Exception) {
                error.message ?: "导出失败"
            }
        }

    suspend fun previewExchangeFile(resolver: ContentResolver, uri: Uri): ExchangeImportSummary =
        withContext(Dispatchers.IO) {
            val input = resolver.openInputStream(uri) ?: throw IllegalStateException("无法读取所选文件")
            exchangeService.previewImport(input)
        }

    suspend fun applyExchangeImport(mode: ImportMode): String =
        withContext(Dispatchers.IO) {
            try {
                val result = exchangeService.applyPendingImport(mode)
                val action = if (result.mode == ImportMode.REPLACE) "替换本机数据" else "合并数据"
                "已" + action + "：课表 " + result.schedules + "，课程 " + result.courses +
                    "，考试 " + result.exams + "，待办 " + result.todos
            } catch (error: Exception) {
                exchangeService.discardPendingImport()
                error.message ?: "导入失败，未写入数据"
            }
        }

    fun cancelExchangeImport() = exchangeService.discardPendingImport()

    suspend fun addTodo(title: String, details: String, dueAt: String): String? =
        try {
            repository.addTodo(title, details, dueAt.ifBlank { null }, ZoneId.systemDefault().id)
            null
        } catch (error: Exception) {
            error.message ?: "新增待办失败"
        }

    fun toggleTodo(todo: TodoEntity, completed: Boolean) {
        viewModelScope.launch {
            runCatching { repository.setTodoCompleted(todo.localId, completed) }
                .onFailure { error -> mutableMessages.emit(error.message ?: "更新待办失败") }
        }
    }

    fun deleteTodo(todo: TodoEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteTodo(todo.localId) }
                .onFailure { error -> mutableMessages.emit(error.message ?: "删除待办失败") }
                .onSuccess { mutableMessages.emit("待办已删除") }
        }
    }

    fun deleteCourse(course: CourseEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteCourse(course.localId) }
                .onFailure { error -> mutableMessages.emit(error.message ?: "删除课程失败") }
                .onSuccess { mutableMessages.emit("课程已删除") }
        }
    }

    fun deleteExam(exam: ExamEntity) {
        viewModelScope.launch {
            runCatching { repository.deleteExam(exam.localId) }
                .onFailure { error -> mutableMessages.emit(error.message ?: "删除考试失败") }
                .onSuccess { mutableMessages.emit("考试及其关联待办已删除") }
        }
    }

    fun reconcilePastExamTodos() {
        viewModelScope.launch {
            runCatching { repository.reconcilePastExamTodos() }
                .onFailure { error -> mutableMessages.emit(error.message ?: "考试待办状态同步失败") }
        }
    }

    companion object {
        fun factory(
            repository: TimetableRepository,
            preferences: AppPreferencesRepository,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    if (!modelClass.isAssignableFrom(MainViewModel::class.java)) {
                        throw IllegalArgumentException("Unsupported ViewModel: " + modelClass.name)
                    }
                    return MainViewModel(repository, preferences) as T
                }
            }
    }
}
