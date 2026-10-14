package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.entity.Task;
import com.timetable.mapper.TaskMapper;
import com.timetable.service.TaskService;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
public class TaskServiceImpl implements TaskService {

    /** 与 AiPromptBuilder 的【当前任务】段预算保持一致：截止时间窗（天）。 */
    public static final int OPEN_TASK_HORIZON_DAYS = 14;

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
}
