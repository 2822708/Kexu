package com.kexu.timetable.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.time.LocalDate

@Composable
fun ScheduleEditorDialog(
    onDismiss: () -> Unit,
    onSave: suspend (String, String, String) -> String?,
) {
    val today = LocalDate.now()
    val monday = today.minusDays((today.dayOfWeek.value - 1).toLong())
    var name by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableStateOf(monday.toString()) }
    var end by rememberSaveable { mutableStateOf(monday.plusWeeks(19).plusDays(6).toString()) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建课表") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(name, { name = it }, label = { Text("课表名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(start, { start = it }, label = { Text("学期开始（YYYY-MM-DD）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(end, { end = it }, label = { Text("学期结束（YYYY-MM-DD）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    try {
                        if (LocalDate.parse(end).isBefore(LocalDate.parse(start))) {
                            error = "结束日期不能早于开始日期"
                        } else {
                            scope.launch {
                                saving = true
                                error = onSave(name, start, end)
                                saving = false
                                if (error == null) onDismiss()
                            }
                        }
                    } catch (_: Exception) {
                        error = "日期请按 YYYY-MM-DD 填写"
                    }
                },
            ) { Text(if (saving) "保存中" else "创建") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}
