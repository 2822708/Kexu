package com.tangent.timetable.feature.todos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.tangent.timetable.core.database.TodoEntity
import kotlinx.coroutines.launch
import java.time.LocalDateTime

@Composable
fun TodosScreen(
    modifier: Modifier = Modifier,
    todos: List<TodoEntity>,
    onComplete: (TodoEntity, Boolean) -> Unit,
    onDelete: (TodoEntity) -> Unit,
) {
    if (todos.isEmpty()) {
        Column(
            modifier = modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("把要做的事放在这里", style = MaterialTheme.typography.titleLarge)
            Text("新增后会保存在本机，也可以在设置中导出。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    } else {
        val open = todos.filterNot { it.completed }
        val completed = todos.filter { it.completed }
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (open.isNotEmpty()) item { Text("待完成 · " + open.size, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(open, key = { it.publicId }) { todo ->
                TodoCard(todo, onComplete, onDelete)
            }
            if (completed.isNotEmpty()) item { Text("已完成 · " + completed.size, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) }
            items(completed, key = { it.publicId }) { todo ->
                TodoCard(todo, onComplete, onDelete)
            }
        }
    }
}

@Composable
private fun TodoCard(
    todo: TodoEntity,
    onComplete: (TodoEntity, Boolean) -> Unit,
    onDelete: (TodoEntity) -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = todo.completed, onCheckedChange = { onComplete(todo, it) })
            Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(
                    todo.title,
                    style = MaterialTheme.typography.titleMedium,
                    textDecoration = if (todo.completed) TextDecoration.LineThrough else TextDecoration.None,
                )
                if (todo.dueAt != null) {
                    Text(
                        "截止 " + todo.dueAt.take(16).replace('T', ' '),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (todo.details.isNotBlank()) {
                    Text(todo.details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
                }
                if (todo.examLocalId != null) {
                    Text("考试关联待办", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                }
            }
            IconButton(onClick = { showDeleteConfirm = true }) {
                Icon(Icons.Rounded.DeleteOutline, contentDescription = "删除待办")
            }
        }
    }
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除待办？") },
            text = {
                Text(
                    if (todo.examLocalId == null) "“" + todo.title + "”将从本机删除。"
                    else "这条待办与考试关联。请到考试安排中删除对应考试，以保持两边一致。",
                )
            },
            confirmButton = {
                Button(
                    enabled = todo.examLocalId == null,
                    onClick = { showDeleteConfirm = false; onDelete(todo) },
                ) { Text(if (todo.examLocalId == null) "删除" else "去考试安排") }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("关闭") } },
        )
    }
}

@Composable
fun TodoEditorDialog(
    onDismiss: () -> Unit,
    onSave: suspend (String, String, String) -> String?,
) {
    var title by rememberSaveable { mutableStateOf("") }
    var details by rememberSaveable { mutableStateOf("") }
    var dueAt by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新增待办") },
        text = {
            Column(modifier = Modifier.fillMaxWidth().height(390.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("待办标题 *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(dueAt, { dueAt = it }, label = { Text("截止时间（可选，YYYY-MM-DDTHH:mm）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(details, { details = it }, label = { Text("备注") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                Text("时间按当前设备时区解释；留空表示没有截止时间。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    if (title.isBlank()) {
                        error = "请填写待办标题"
                    } else {
                        val normalizedDue = dueAt.trim()
                        if (normalizedDue.isNotEmpty() && runCatching { LocalDateTime.parse(normalizedDue) }.isFailure) {
                            error = "截止时间格式应为 YYYY-MM-DDTHH:mm"
                        } else {
                            scope.launch {
                                saving = true
                                error = onSave(title, details, normalizedDue)
                                saving = false
                                if (error == null) onDismiss()
                            }
                        }
                    }
                },
            ) { Text(if (saving) "保存中" else "保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}
