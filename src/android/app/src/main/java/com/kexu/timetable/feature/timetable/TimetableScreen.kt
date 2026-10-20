package com.kexu.timetable.feature.timetable

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kexu.timetable.core.database.CourseEntity
import com.kexu.timetable.core.database.ExamEntity
import com.kexu.timetable.core.database.PeriodConfigEntity
import com.kexu.timetable.core.database.ScheduleEntity
import com.kexu.timetable.core.time.TermWeekCalculator
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.UUID

private val weekdayNames = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

@Composable
fun TimetableScreen(
    modifier: Modifier = Modifier,
    schedule: ScheduleEntity,
    courses: List<CourseEntity>,
    periods: List<PeriodConfigEntity>,
    selectedWeek: Int,
    selectedDay: Int,
    onWeekChange: (Int) -> Unit,
    onDayChange: (Int) -> Unit,
    onEdit: (CourseEntity) -> Unit,
    onDelete: (CourseEntity) -> Unit,
) {
    val startDate = LocalDate.parse(schedule.startDate)
    val endDate = LocalDate.parse(schedule.endDate)
    val totalWeeks = TermWeekCalculator.totalWeeks(startDate, endDate)
    val dayDate = TermWeekCalculator.dateFor(startDate, selectedWeek.coerceIn(1, totalWeeks), selectedDay)

    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            IconButton(onClick = { if (selectedWeek > 1) onWeekChange(selectedWeek - 1) }) {
                Icon(Icons.Rounded.ChevronLeft, contentDescription = "上一周")
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("第 " + selectedWeek + " / " + totalWeeks + " 周", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(dayDate.toString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { if (selectedWeek < totalWeeks) onWeekChange(selectedWeek + 1) }) {
                Icon(Icons.Rounded.ChevronRight, contentDescription = "下一周")
            }
        }
        LazyRow(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
        ) {
            items(weekdayNames.size) { index ->
                FilterChip(
                    selected = selectedDay == index + 1,
                    onClick = { onDayChange(index + 1) },
                    label = { Text(weekdayNames[index]) },
                )
            }
        }
        if (courses.isEmpty()) {
            EmptyScheduleState(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp))
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 112.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Text(
                        weekdayNames[selectedDay - 1] + " · " + courses.size + " 门课程",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 2.dp, bottom = 2.dp),
                    )
                }
                items(courses, key = { it.publicId }) { course ->
                    CourseCard(
                        course = course,
                        periods = periods,
                        onEdit = { onEdit(course) },
                        onDelete = { onDelete(course) },
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyScheduleState(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier.size(68.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Edit, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(30.dp))
        }
        Text("这一天还没有课程", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp))
        Text("点右下角添加课程；没有网络也能继续编辑。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun CourseCard(
    course: CourseEntity,
    periods: List<PeriodConfigEntity>,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val start = periods.firstOrNull { it.periodNumber == course.startPeriod }?.startTime ?: "—"
    val end = periods.firstOrNull { it.periodNumber == course.endPeriod }?.endTime ?: "—"
    val fallbackColor = MaterialTheme.colorScheme.primary
    val swatch = remember(course.colorHex, fallbackColor) {
        runCatching { Color(android.graphics.Color.parseColor(course.colorHex)) }.getOrDefault(fallbackColor)
    }

    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(width = 5.dp, height = 62.dp).clip(CircleShape).background(swatch),
            )
            Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                Text(course.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    course.startPeriod.toString() + "–" + course.endPeriod + " 节  ·  " + start + "–" + end,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
                val extra = listOf(course.location, course.teacher).filter { it.isNotBlank() }.joinToString("  ·  ")
                if (extra.isNotBlank()) {
                    Text(extra, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 3.dp))
                }
            }
            IconButton(onClick = onEdit) { Icon(Icons.Rounded.Edit, contentDescription = "编辑课程") }
            IconButton(onClick = { showDeleteConfirm = true }) { Icon(Icons.Rounded.DeleteOutline, contentDescription = "删除课程") }
        }
    }
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除课程？") },
            text = { Text("“" + course.name + "”将从本机课表中删除。") },
            confirmButton = {
                Button(onClick = { showDeleteConfirm = false; onDelete() }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseEditorDialog(
    schedule: ScheduleEntity,
    periods: List<PeriodConfigEntity>,
    initial: CourseEntity?,
    onDismiss: () -> Unit,
    onSave: suspend (CourseEntity) -> String?,
) {
    val totalWeeks = TermWeekCalculator.totalWeeks(LocalDate.parse(schedule.startDate), LocalDate.parse(schedule.endDate))
    var name by remember(initial?.publicId) { mutableStateOf(initial?.name.orEmpty()) }
    var teacher by remember(initial?.publicId) { mutableStateOf(initial?.teacher.orEmpty()) }
    var location by remember(initial?.publicId) { mutableStateOf(initial?.location.orEmpty()) }
    var note by remember(initial?.publicId) { mutableStateOf(initial?.note.orEmpty()) }
    var weekInput by remember(initial?.publicId) { mutableStateOf(initial?.weeks?.joinToString(", ") ?: "1-" + totalWeeks) }
    var day by remember(initial?.publicId) { mutableStateOf(initial?.dayOfWeek ?: LocalDate.now().dayOfWeek.value) }
    var startPeriod by remember(initial?.publicId) { mutableStateOf((initial?.startPeriod ?: 1).toString()) }
    var endPeriod by remember(initial?.publicId) { mutableStateOf((initial?.endPeriod ?: 2).toString()) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val maxPeriod = periods.maxOfOrNull { it.periodNumber } ?: 12

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "添加课程" else "编辑课程") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(name, { name = it }, label = { Text("课程名称 *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("上课日", style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(weekdayNames.size) { index ->
                        FilterChip(selected = day == index + 1, onClick = { day = index + 1 }, label = { Text(weekdayNames[index]) })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(startPeriod, { startPeriod = it.filter(Char::isDigit) }, label = { Text("开始节") }, modifier = Modifier.weight(1f), singleLine = true)
                    OutlinedTextField(endPeriod, { endPeriod = it.filter(Char::isDigit) }, label = { Text("结束节") }, modifier = Modifier.weight(1f), singleLine = true)
                }
                OutlinedTextField(weekInput, { weekInput = it }, label = { Text("教学周（如 1-16, 18）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(location, { location = it }, label = { Text("教室") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(teacher, { teacher = it }, label = { Text("教师") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(note, { note = it }, label = { Text("备注") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                Text("学期共 " + totalWeeks + " 周。重叠节次且周次交集的课程无法保存。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    val start = startPeriod.toIntOrNull()
                    val end = endPeriod.toIntOrNull()
                    val weeks = parseWeeks(weekInput, totalWeeks)
                    if (name.isBlank()) {
                        error = "请填写课程名称"
                    } else if (start == null || end == null || start !in 1..maxPeriod || end !in start..maxPeriod) {
                        error = "节次需在 1 到 " + maxPeriod + " 之间，且结束节不能早于开始节"
                    } else if (weeks == null) {
                        error = "周次格式有误，范围应在 1 到 " + totalWeeks + " 之间"
                    } else {
                        val course = CourseEntity(
                            localId = initial?.localId ?: 0,
                            publicId = initial?.publicId ?: UUID.randomUUID().toString(),
                            scheduleLocalId = schedule.localId,
                            name = name,
                            teacher = teacher,
                            location = location,
                            colorHex = initial?.colorHex ?: "#658C73",
                            note = note,
                            dayOfWeek = day,
                            startPeriod = start,
                            endPeriod = end,
                            weeks = weeks,
                        )
                        scope.launch {
                            saving = true
                            error = onSave(course)
                            saving = false
                            if (error == null) onDismiss()
                        }
                    }
                },
            ) { Text(if (saving) "保存中" else "保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}

@Composable
fun ExamEditorDialog(
    schedule: ScheduleEntity,
    initial: ExamEntity?,
    onDismiss: () -> Unit,
    onSave: suspend (ExamEntity) -> String?,
) {
    val today = LocalDate.now()
    var name by remember(initial?.publicId) { mutableStateOf(initial?.name.orEmpty()) }
    var location by remember(initial?.publicId) { mutableStateOf(initial?.location.orEmpty()) }
    var date by remember(initial?.publicId) { mutableStateOf(initial?.startAt?.take(10) ?: today.toString()) }
    var startTime by remember(initial?.publicId) { mutableStateOf(initial?.startAt?.drop(11)?.take(5) ?: "09:00") }
    var endTime by remember(initial?.publicId) { mutableStateOf(initial?.endAt?.drop(11)?.take(5) ?: "10:00") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "添加考试" else "编辑考试") },
        text = {
            Column(modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("考试名称 *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(date, { date = it }, label = { Text("日期（YYYY-MM-DD）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(startTime, { startTime = it }, label = { Text("开始（HH:mm）") }, modifier = Modifier.weight(1f), singleLine = true)
                    OutlinedTextField(endTime, { endTime = it }, label = { Text("结束（HH:mm）") }, modifier = Modifier.weight(1f), singleLine = true)
                }
                OutlinedTextField(location, { location = it }, label = { Text("考场") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("保存后会同步生成一条关联待办；删除考试会一起删除该待办。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    val validTimes = runCatching {
                        val start = LocalDateTime.parse(date + "T" + startTime)
                        val end = LocalDateTime.parse(date + "T" + endTime)
                        start to end
                    }.getOrNull()
                    if (name.isBlank()) error = "请填写考试名称"
                    else if (validTimes == null || !validTimes.second.isAfter(validTimes.first)) error = "请检查日期和起止时间"
                    else {
                        val exam = ExamEntity(
                            localId = initial?.localId ?: 0,
                            publicId = initial?.publicId ?: UUID.randomUUID().toString(),
                            scheduleLocalId = schedule.localId,
                            name = name,
                            location = location,
                            startAt = validTimes.first.toString(),
                            endAt = validTimes.second.toString(),
                            zoneId = schedule.zoneId,
                        )
                        scope.launch {
                            saving = true
                            error = onSave(exam)
                            saving = false
                            if (error == null) onDismiss()
                        }
                    }
                },
            ) { Text(if (saving) "保存中" else "保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}

private fun parseWeeks(input: String, totalWeeks: Int): List<Int>? {
    val result = sortedSetOf<Int>()
    val tokens = input.split(',', '，', ' ', '、').filter { it.isNotBlank() }
    if (tokens.isEmpty()) return null
    for (token in tokens) {
        val range = Regex("""^(\d+)[-~](\d+)$""").matchEntire(token)
        if (range != null) {
            val from = range.groupValues[1].toIntOrNull() ?: return null
            val to = range.groupValues[2].toIntOrNull() ?: return null
            if (from > to || from !in 1..totalWeeks || to !in 1..totalWeeks) return null
            result.addAll(from..to)
        } else {
            val week = token.toIntOrNull() ?: return null
            if (week !in 1..totalWeeks) return null
            result.add(week)
        }
    }
    return result.toList().takeIf { it.isNotEmpty() }
}
