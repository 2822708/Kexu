package com.tangent.timetable.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.Card
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tangent.timetable.core.database.PeriodConfigEntity
import com.tangent.timetable.core.database.ScheduleEntity
import java.time.LocalDate

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    schedule: ScheduleEntity,
    periods: List<PeriodConfigEntity>,
    onExport: () -> Unit,
    onImport: () -> Unit,
    onAddSchedule: () -> Unit,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("当前课表", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(schedule.name, style = MaterialTheme.typography.bodyLarge)
                    Text(schedule.startDate + " 至 " + schedule.endDate, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("时区 " + schedule.zoneId, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = onAddSchedule, modifier = Modifier.fillMaxWidth()) {
                        androidx.compose.material3.Icon(Icons.Rounded.Add, contentDescription = null)
                        Text("  新建课表")
                    }
                }
            }
        }
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("数据与备份", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text("业务数据保存在手机本地。备份文件不包含 AI 密钥、账号凭据或系统通知权限。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = onExport, modifier = Modifier.fillMaxWidth()) {
                        androidx.compose.material3.Icon(Icons.Rounded.FileDownload, contentDescription = null)
                        Text("  导出 JSON 交换文件")
                    }
                    OutlinedButton(onClick = onImport, modifier = Modifier.fillMaxWidth()) {
                        androidx.compose.material3.Icon(Icons.Rounded.FileUpload, contentDescription = null)
                        Text("  导入或恢复")
                    }
                }
            }
        }
        item {
            Text("作息时间（默认配置）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
        }
        items(periods, key = { it.periodNumber }) { period ->
            Card(modifier = Modifier.fillMaxWidth()) {
                androidx.compose.foundation.layout.Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 11.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(period.label)
                    Text(period.startTime + " – " + period.endTime, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("当前已落地", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text("• 离线课表、课程冲突校验、考试及其关联待办、独立待办", style = MaterialTheme.typography.bodyMedium)
                    Text("• 教学周算法与课程、考试、待办的本地持久化", style = MaterialTheme.typography.bodyMedium)
                    Text("• JSON 备份导入导出；下一步继续接入循环规则、提醒、AI 和小组件", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.padding(bottom = 96.dp)) }
    }
}
