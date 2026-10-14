package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.TaskCreateRequest;
import com.timetable.dto.TaskExtractRequest;
import com.timetable.dto.TaskExtractResult;
import com.timetable.entity.Task;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.AiService;
import com.timetable.service.TaskService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 任务管理（AI Campus Agent V1.0）。
 *
 * <p>POST /api/tasks/extract 只产出草稿（不落库），用户核对/编辑后
 * POST /api/tasks 批量落库（source=AI_PARSE），human-in-the-loop。
 */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService taskService;
    private final AiService aiService;

    public TaskController(TaskService taskService, AiService aiService) {
        this.taskService = taskService;
        this.aiService = aiService;
    }

    @PostMapping("/extract")
    public ApiResponse<TaskExtractResult> extract(@Valid @RequestBody TaskExtractRequest request) {
        return ApiResponse.success(aiService.extractTasks(request, RequestContext.getApiKey()));
    }

    @PostMapping
    public ApiResponse<List<Task>> create(@Valid @RequestBody TaskCreateRequest request) {
        List<Task> created = taskService.createBatch(
                RequestContext.getApiKey(), request.getTasks(), Task.SOURCE_AI_PARSE);
        return ApiResponse.success(created);
    }
}
