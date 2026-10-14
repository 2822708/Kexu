package com.timetable.service;

import com.timetable.dto.TaskDraft;
import com.timetable.entity.Task;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 任务服务（AI Campus Agent V1.0）。
 *
 * Step 4 开放：聊天上下文读取面 + 抽取草稿确认后的批量创建；
 * Step 5 开放：完整 CRUD 与状态流转（列表筛选 / 查询 / 修改 / 删除 / 状态流转）。
 */
public interface TaskService {

    /**
     * 未完成任务读取（聊天上下文【当前任务】段的数据源）：
     * 状态为 PENDING / IN_PROGRESS；截止时间在 {@code now} 起 14 天内、已逾期、
     * 或未设置截止（视为当前任务）。按截止时间升序排列，无截止的排在后。
     * 返回窗口内全部命中记录；注入 prompt 的条数预算（15 条）由 AiPromptBuilder 控制。
     */
    List<Task> listOpen(String apiKey, LocalDateTime now);

    /** 全部任务（指纹基线用：任何字段变化都必须能被察觉，因此不做筛选）。 */
    List<Task> list(String apiKey);

    /**
     * 列表查询（Dashboard / 任务页）：status、type、截止窗口均可选；
     * 排序固定为截止升序（无截止排后）、同截止按 id 升序。
     */
    List<Task> list(String apiKey, String status, String type,
                    LocalDateTime deadlineBefore, LocalDateTime deadlineAfter);

    /** 按 id 查询（归属校验，非本人返回 404）。 */
    Task get(Long id, String apiKey);

    /** 创建单个任务（草稿字段清洗：标题必填≤500、类型白名单、优先级钳制 1-3、描述≤2000）。 */
    Task create(String apiKey, TaskDraft draft, String source);

    /** 创建单个任务并标注来源凭证（AI 提案执行时传 messageId，便于审计与追溯）。 */
    Task create(String apiKey, TaskDraft draft, String source, String sourceRef);

    /** 批量创建；任一条草稿非法即整体回滚（调用方的事务保证不会落半截数据）。 */
    List<Task> createBatch(String apiKey, List<TaskDraft> drafts, String source);

    /**
     * 修改任务（补丁语义）：
     * 标题必填；type/priority 为空保持原值；deadline 为 null 表示清除
     * （前端编辑模态与 AI 提案均按完整字段提交，null 即「没有截止」）；
     * description 为空表示清除；status 非空时校验白名单后流转。
     */
    Task update(Long id, TaskDraft draft, String apiKey);

    /** 删除任务（硬删除，与待办模块一致）。 */
    void delete(Long id, String apiKey);

    /** 状态流转（PENDING / IN_PROGRESS / DONE / CANCELLED）。 */
    Task updateStatus(Long id, String status, String apiKey);
}
