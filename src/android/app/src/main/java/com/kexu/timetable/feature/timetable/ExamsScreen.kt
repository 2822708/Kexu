package com.kexu.timetable.feature.timetable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kexu.timetable.core.database.ExamEntity

@Composable
fun ExamsScreen(
    modifier: Modifier = Modifier,
    exams: List<ExamEntity>,
    onEdit: (ExamEntity) -> Unit,
    onDelete: (ExamEntity) -> Unit,
) {
    if (exams.isEmpty()) {
        Column(
            modifier = modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("考试日程一目了然", style = MaterialTheme.typography.titleLarge)
            Text("每场考试都会生成一条关联待办。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(exams, key = { it.publicId }) { exam ->
                ExamCard(exam, onEdit = { onEdit(exam) }, onDelete = { onDelete(exam) })
            }
        }
    }
}

@Composable
private fun ExamCard(exam: ExamEntity, onEdit: () -> Unit, onDelete: () -> Unit) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(exam.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(exam.startAt.take(16).replace('T', ' ') + " – " + exam.endAt.take(16).replace('T', ' '), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 5.dp))
                if (exam.location.isNotBlank()) {
                    Text(exam.location, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 3.dp))
                }
                Text("将同步关联一条考试待办", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 7.dp))
            }
            IconButton(onClick = onEdit) { Icon(Icons.Rounded.Edit, contentDescription = "编辑考试") }
            IconButton(onClick = { showDeleteConfirm = true }) { Icon(Icons.Rounded.DeleteOutline, contentDescription = "删除考试") }
        }
    }
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除考试安排？") },
            text = { Text("考试“" + exam.name + "”及其自动生成的关联待办会一起删除。") },
            confirmButton = { Button(onClick = { showDeleteConfirm = false; onDelete() }) { Text("一起删除") } },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") } },
        )
    }
}
