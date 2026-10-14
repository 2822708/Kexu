package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.dto.TaskDraft;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.TaskMapper;
import com.timetable.service.TaskService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
public class TaskServiceImpl implements TaskService {

    /** 与 AiPromptBuilder 的【当前任务】段预算保持一致：截止时间窗（天）。 */
    public static final int OPEN_TASK_HORIZON_DAYS = 14;

    private static final int MAX_TITLE_CHARS = 500;
    private static final int MAX_DESCRIPTION_CHARS = 2000;
    private static final int MAX_BATCH = 20;

    private static final Set<String> ALLOWED_TYPES = Set.of(
            Task.TYPE_COURSE_WORK, Task.TYPE_LAB_REPORT, Task.TYPE_ONLINE_COURSE,
            Task.TYPE_EXAM, Task.TYPE_COMPETITION, Task.TYPE_OTHER);

    private final TaskMapper mapper;

    public TaskServiceImpl(TaskMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public List<Task> listOpen(String apiKey, LocalDateTime now) {
        if (apiKey == null || apiKey.isBlank()) {
            return List.of();
        }
        List<Task> open = mapper.selectList(new LambdaQueryWrapper<Task>()
                .eq(Task::getApiKey, apiKey)
                .in(Task::getStatus, List.of(Task.STATUS_PENDING, Task.STATUS_IN_PROGRESS))
                .orderByAsc(Task::getDeadline)
                .orderByAsc(Task::getId));
        LocalDateTime horizon = (now == null ? LocalDateTime.now() : now).plusDays(OPEN_TASK_HORIZON_DAYS);
        List<Task> withDeadline = new ArrayList<>();
        List<Task> withoutDeadline = new ArrayList<>();
        for (Task task : open) {
            // 无截止时间 = 当前任务，保留；超出 14 天窗口的暂不进入上下文（预算控制）
            if (task.getDeadline() == null) {
                withoutDeadline.add(task);
            } else if (!task.getDeadline().isAfter(horizon)) {
                withDeadline.add(task);
            }
        }
        List<Task> merged = new ArrayList<>(withDeadline);
        merged.addAll(withoutDeadline);
        return merged;
    }

    @Override
    public Task create(String apiKey, TaskDraft draft, String source) {
        if (draft == null) {
            throw new BusinessException(400, "任务内容为空");
        }
        String title = draft.getTitle() == null ? "" : draft.getTitle().trim();
        if (title.isEmpty()) {
            throw new BusinessException(400, "任务标题不能为空");
        }
        if (title.length() > MAX_TITLE_CHARS) {
            throw new BusinessException(400, "任务标题过长（最多 " + MAX_TITLE_CHARS + " 字）");
        }
        String type = draft.getType() == null || draft.getType().isBlank()
                ? Task.TYPE_OTHER : draft.getType().trim().toUpperCase();
        if (!ALLOWED_TYPES.contains(type)) {
            throw new BusinessException(400, "不支持的任务类型: " + draft.getType());
        }
        int priority = draft.getPriority() == null ? Task.PRIORITY_MEDIUM : draft.getPriority();
        if (priority < Task.PRIORITY_HIGH || priority > Task.PRIORITY_LOW) {
            throw new BusinessException(400, "任务优先级必须是 1（高）/ 2（中）/ 3（低）");
        }
        String description = draft.getDescription() == null ? "" : draft.getDescription().trim();
        if (description.length() > MAX_DESCRIPTION_CHARS) {
            throw new BusinessException(400, "任务描述过长（最多 " + MAX_DESCRIPTION_CHARS + " 字）");
        }
        Task task = new Task();
        task.setApiKey(apiKey);
        task.setTitle(title);
        task.setType(type);
        task.setPriority(priority);
        task.setStatus(Task.STATUS_PENDING);
        task.setDeadline(draft.getDeadline());
        task.setDescription(description.isEmpty() ? null : description);
        task.setSource(source == null || source.isBlank() ? Task.SOURCE_MANUAL : source);
        LocalDateTime now = LocalDateTime.now();
        task.setCreatedAt(now);
        task.setUpdatedAt(now);
        mapper.insert(task);
        return task;
    }

    /**
     * 批量创建：任一条非法整体回滚（草稿确认是“全有或全无”的用户操作，
     * 不接受落半截后让用户面对残留数据）。
     */
    @Override
    @Transactional
    public List<Task> createBatch(String apiKey, List<TaskDraft> drafts, String source) {
        if (drafts == null || drafts.isEmpty()) {
            throw new BusinessException(400, "任务列表不能为空");
        }
        if (drafts.size() > MAX_BATCH) {
            throw new BusinessException(400, "一次最多创建 " + MAX_BATCH + " 个任务");
        }
        List<Task> created = new ArrayList<>(drafts.size());
        for (TaskDraft draft : drafts) {
            created.add(create(apiKey, draft, source));
        }
        return created;
    }
}
