package com.timetable.service;

import com.timetable.entity.Task;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 任务服务（AI Campus Agent V1.0）。
 *
 * V1.0 Step 3 只开放聊天上下文所需的读取面；完整 CRUD 与状态流转在 Step 5 上线。
 */
public interface TaskService {

    /**
     * 未完成任务读取（聊天上下文【当前任务】段的数据源）：
     * 状态为 PENDING / IN_PROGRESS；截止时间在 {@code now} 起 14 天内、已逾期、
     * 或未设置截止（视为当前任务）。按截止时间升序排列，无截止的排在后。
     * 返回窗口内全部命中记录；注入 prompt 的条数预算（15 条）由 AiPromptBuilder 控制。
     */
    List<Task> listOpen(String apiKey, LocalDateTime now);
}
