package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.TaskCreateRequest;
import com.timetable.dto.TaskDraft;
import com.timetable.dto.TaskExtractRequest;
import com.timetable.dto.TaskExtractResult;
import com.timetable.entity.Task;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.AiService;
import com.timetable.service.TaskService;
import com.timetable.service.impl.AiServiceImpl;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 任务管理（AI Campus Agent V1.0）。
 *
 * <p>POST /api/tasks/extract 只产出草稿（不落库），用户核对/编辑后
 * POST /api/tasks 批量落库（source=AI_PARSE），human-in-the-loop。
 * Step 5 起开放完整 CRUD 与状态流转。
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

    @GetMapping
    public ApiResponse<List<Task>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime deadlineBefore,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            LocalDateTime deadlineAfter) {
        return ApiResponse.success(taskService.list(
                RequestContext.getApiKey(), status, type, deadlineBefore, deadlineAfter));
    }

    @GetMapping("/{id}")
    public ApiResponse<Task> get(@PathVariable Long id) {
        return ApiResponse.success(taskService.get(id, RequestContext.getApiKey()));
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

    @PutMapping("/{id}")
    public ApiResponse<Task> update(@PathVariable Long id, @Valid @RequestBody TaskDraft draft) {
        String apiKey = RequestContext.getApiKey();
        Task task = taskService.update(id, draft, apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_TASK);
        return ApiResponse.success(task);
    }

    @PatchMapping("/{id}/status")
    public ApiResponse<Task> updateStatus(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String apiKey = RequestContext.getApiKey();
        Task task = taskService.updateStatus(id, body.get("status"), apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_TASK);
        return ApiResponse.success(task);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        String apiKey = RequestContext.getApiKey();
        taskService.delete(id, apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_TASK);
        return ApiResponse.success(null);
    }
}
