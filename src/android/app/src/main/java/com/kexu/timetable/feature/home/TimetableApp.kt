package com.kexu.timetable.feature.home

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CheckCircleOutline
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.kexu.timetable.MainViewModel
import com.kexu.timetable.core.backup.ExchangeImportSummary
import com.kexu.timetable.core.backup.ImportMode
import com.kexu.timetable.core.database.CourseEntity
import com.kexu.timetable.core.database.ExamEntity
import com.kexu.timetable.core.database.ScheduleEntity
import com.kexu.timetable.feature.timetable.CourseEditorDialog
import com.kexu.timetable.feature.timetable.ExamEditorDialog
import com.kexu.timetable.feature.timetable.ExamsScreen
import com.kexu.timetable.feature.timetable.TimetableScreen
import com.kexu.timetable.feature.todos.TodoEditorDialog
import com.kexu.timetable.feature.todos.TodosScreen
import com.kexu.timetable.feature.settings.SettingsScreen
import com.kexu.timetable.feature.settings.ScheduleEditorDialog
import kotlinx.coroutines.launch
import java.time.LocalDate

private enum class Destination(val label: String) {
    TIMETABLE("课表"),
    TODOS("待办"),
    EXAMS("考试"),
    SETTINGS("设置"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimetableApp(viewModel: MainViewModel) {
    val schedules by viewModel.schedules.collectAsState()
    val schedule by viewModel.activeSchedule.collectAsState()
    val courses by viewModel.courses.collectAsState()
    val exams by viewModel.exams.collectAsState()
    val todos by viewModel.todos.collectAsState()
    val periods by viewModel.periods.collectAsState()
    val selectedDay by viewModel.selectedDayNumber.collectAsState()
    val selectedWeek by viewModel.selectedWeekNumber.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var destinationName by rememberSaveable { mutableStateOf(Destination.TIMETABLE.name) }
    val destination = Destination.valueOf(destinationName)
    var scheduleMenuOpen by remember { mutableStateOf(false) }
    var showNewCourse by remember { mutableStateOf(false) }
    var editingCourse by remember { mutableStateOf<CourseEntity?>(null) }
    var showNewExam by remember { mutableStateOf(false) }
    var editingExam by remember { mutableStateOf<ExamEntity?>(null) }
    var showNewTodo by remember { mutableStateOf(false) }
    var showNewSchedule by remember { mutableStateOf(false) }
    var importSummary by remember { mutableStateOf<ExchangeImportSummary?>(null) }
    var showReplaceConfirm by remember { mutableStateOf(false) }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri != null) scope.launch {
            snackbar.showSnackbar(viewModel.exportExchangeFile(context.contentResolver, uri))
        }
    }
    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) scope.launch {
            try {
                importSummary = viewModel.previewExchangeFile(context.contentResolver, uri)
            } catch (error: Exception) {
                viewModel.cancelExchangeImport()
                snackbar.showSnackbar(error.message ?: "无法读取交换文件")
            }
        }
    }

    LaunchedEffect(Unit) {
        viewModel.messages.collect { snackbar.showSnackbar(it) }
    }
    LaunchedEffect(schedule?.publicId) {
        val active = schedule ?: return@LaunchedEffect
        val start = LocalDate.parse(active.startDate)
        val end = LocalDate.parse(active.endDate)
        val week = com.kexu.timetable.core.time.TermWeekCalculator.weekFor(start, LocalDate.now())
            .coerceIn(1, com.kexu.timetable.core.time.TermWeekCalculator.totalWeeks(start, end))
        viewModel.setSelectedWeek(week)
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Column {
                        Text(
                            when (destination) {
                                Destination.TIMETABLE -> "我的课表"
                                Destination.TODOS -> "待办清单"
                                Destination.EXAMS -> "考试安排"
                                Destination.SETTINGS -> "设置"
                            },
                            style = MaterialTheme.typography.titleLarge,
                        )
                        if (schedule != null && destination != Destination.SETTINGS) {
                            Text(schedule!!.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                actions = {
                    if (schedules.size > 1 && schedule != null) {
                        TextButton(onClick = { scheduleMenuOpen = true }) { Text("切换") }
                        DropdownMenu(expanded = scheduleMenuOpen, onDismissRequest = { scheduleMenuOpen = false }) {
                            schedules.forEach { item ->
                                DropdownMenuItem(
                                    text = { Text(item.name) },
                                    onClick = {
                                        viewModel.selectSchedule(item)
                                        scheduleMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        bottomBar = {
            if (schedule != null) {
                NavigationBar {
                    Destination.entries.forEach { item ->
                        NavigationBarItem(
                            selected = destination == item,
                            onClick = { destinationName = item.name },
                            icon = {
                                Icon(
                                    when (item) {
                                        Destination.TIMETABLE -> Icons.Rounded.CalendarMonth
                                        Destination.TODOS -> Icons.Rounded.CheckCircleOutline
                                        Destination.EXAMS -> Icons.Rounded.Event
                                        Destination.SETTINGS -> Icons.Rounded.Settings
                                    },
                                    contentDescription = item.label,
                                )
                            },
                            label = { Text(item.label) },
                        )
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            when {
                schedule == null -> Unit
                destination == Destination.TIMETABLE -> androidx.compose.material3.ExtendedFloatingActionButton(
                    onClick = { editingCourse = null; showNewCourse = true },
                    icon = { Icon(Icons.Rounded.CalendarMonth, contentDescription = null) },
                    text = { Text("添加课程") },
                )
                destination == Destination.TODOS -> androidx.compose.material3.ExtendedFloatingActionButton(
                    onClick = { showNewTodo = true },
                    icon = { Icon(Icons.Rounded.CheckCircleOutline, contentDescription = null) },
                    text = { Text("新增待办") },
                )
                destination == Destination.EXAMS -> androidx.compose.material3.ExtendedFloatingActionButton(
                    onClick = { editingExam = null; showNewExam = true },
                    icon = { Icon(Icons.Rounded.Event, contentDescription = null) },
                    text = { Text("添加考试") },
                )
            }
        },
    ) { padding ->
        when {
            schedule == null -> FirstRunScreen(
                modifier = Modifier.padding(padding),
                onCreate = { name, start, end ->
                    scope.launch {
                        val error = viewModel.createSchedule(name, start, end)
                        if (error != null) snackbar.showSnackbar(error)
                        else snackbar.showSnackbar("课表已创建，数据只保存在本机")
                    }
                },
            )
            destination == Destination.TIMETABLE -> TimetableScreen(
                modifier = Modifier.padding(padding),
                schedule = schedule!!,
                courses = courses,
                periods = periods,
                selectedWeek = selectedWeek,
                selectedDay = selectedDay,
                onWeekChange = viewModel::setSelectedWeek,
                onDayChange = viewModel::setSelectedDay,
                onEdit = { course -> editingCourse = course; showNewCourse = true },
                onDelete = viewModel::deleteCourse,
            )
            destination == Destination.TODOS -> TodosScreen(
                modifier = Modifier.padding(padding),
                todos = todos,
                onComplete = viewModel::toggleTodo,
                onDelete = viewModel::deleteTodo,
            )
            destination == Destination.EXAMS -> ExamsScreen(
                modifier = Modifier.padding(padding),
                exams = exams,
                onEdit = { exam -> editingExam = exam; showNewExam = true },
                onDelete = viewModel::deleteExam,
            )
            else -> SettingsScreen(
                modifier = Modifier.padding(padding),
                schedule = schedule!!,
                periods = periods,
                onAddSchedule = { showNewSchedule = true },
                onExport = { exportLauncher.launch("kexu-exchange.json") },
                onImport = { importLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) },
            )
        }
    }

    if (showNewCourse && schedule != null) {
        CourseEditorDialog(
            schedule = schedule!!,
            periods = periods,
            initial = editingCourse,
            onDismiss = { showNewCourse = false; editingCourse = null },
            onSave = viewModel::saveCourse,
        )
    }
    if (showNewExam && schedule != null) {
        ExamEditorDialog(
            schedule = schedule!!,
            initial = editingExam,
            onDismiss = { showNewExam = false; editingExam = null },
            onSave = viewModel::saveExam,
        )
    }
    if (showNewTodo) {
        TodoEditorDialog(
            onDismiss = { showNewTodo = false },
            onSave = viewModel::addTodo,
        )
    }
    if (showNewSchedule) {
        ScheduleEditorDialog(
            onDismiss = { showNewSchedule = false },
            onSave = viewModel::createSchedule,
        )
    }
    importSummary?.let { summary ->
        AlertDialog(
            onDismissRequest = { viewModel.cancelExchangeImport(); importSummary = null },
            title = { Text("导入预览") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("来源数据集：" + summary.sourceDatasetId, style = MaterialTheme.typography.bodySmall)
                    Text("课表 " + summary.schedules + " · 课程 " + summary.courses)
                    Text("考试 " + summary.exams + " · 待办 " + summary.todos + " · 作息节次 " + summary.periods)
                    Text("合并会跳过相同 publicId 且内容完全相同的记录；遇到内容不同的重复 ID 时整份回滚。")
                    Text("完整替换会清空本机现有业务数据，且不会覆盖本机数据集身份。", color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.End) {
                    TextButton(onClick = {
                        scope.launch {
                            val message = viewModel.applyExchangeImport(ImportMode.MERGE)
                            importSummary = null
                            snackbar.showSnackbar(message)
                        }
                    }) { Text("合并到本机") }
                    Button(onClick = { importSummary = null; showReplaceConfirm = true }) { Text("选择全量替换") }
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelExchangeImport(); importSummary = null }) { Text("取消") }
            },
        )
    }
    if (showReplaceConfirm) {
        AlertDialog(
            onDismissRequest = { showReplaceConfirm = false; viewModel.cancelExchangeImport() },
            title = { Text("确认替换本机数据？") },
            text = { Text("当前课表、课程、考试和待办将被清空，并替换为所选文件内容。此操作无法撤销；建议先导出当前数据。") },
            confirmButton = {
                Button(onClick = {
                    showReplaceConfirm = false
                    scope.launch { snackbar.showSnackbar(viewModel.applyExchangeImport(ImportMode.REPLACE)) }
                }) { Text("清空并恢复") }
            },
            dismissButton = {
                TextButton(onClick = { showReplaceConfirm = false; viewModel.cancelExchangeImport() }) { Text("返回") }
            },
        )
    }
}

@Composable
private fun FirstRunScreen(
    modifier: Modifier = Modifier,
    onCreate: (String, String, String) -> Unit,
) {
    val today = LocalDate.now()
    val monday = today.minusDays((today.dayOfWeek.value - 1).toLong())
    var name by rememberSaveable { mutableStateOf("我的课表") }
    var startDate by rememberSaveable { mutableStateOf(monday.toString()) }
    var endDate by rememberSaveable { mutableStateOf(monday.plusWeeks(19).plusDays(6).toString()) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 30.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("先建一张课表", style = MaterialTheme.typography.headlineMedium)
        Text(
            "课表、考试和待办保存在这台设备。首次设置好学期后，即可离线使用。",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(name, { name = it }, label = { Text("课表名称") }, singleLine = true)
        OutlinedTextField(startDate, { startDate = it }, label = { Text("学期开始日期（YYYY-MM-DD）") }, singleLine = true)
        OutlinedTextField(endDate, { endDate = it }, label = { Text("学期结束日期（YYYY-MM-DD）") }, singleLine = true)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        androidx.compose.material3.Button(
            onClick = {
                try {
                    if (LocalDate.parse(endDate).isBefore(LocalDate.parse(startDate))) {
                        error = "结束日期不能早于开始日期"
                    } else {
                        error = null
                        onCreate(name, startDate, endDate)
                    }
                } catch (_: Exception) {
                    error = "日期请按 YYYY-MM-DD 填写"
                }
            },
            modifier = Modifier.padding(top = 8.dp),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 14.dp),
        ) { Text("创建课表") }
        Text(
            "第一教学周从开学日期所在周的周一开始；默认预置 12 个节次，可在设置中查看作息。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
