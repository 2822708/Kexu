package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.MemoryListResponse;
import com.timetable.dto.MemoryRequest;
import com.timetable.entity.Memory;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.MemoryService;
import com.timetable.service.impl.AiPromptBuilder;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 长期记忆管理（AI Campus Agent V1.0 Step 7）。
 *
 * <p>AI 提炼的记忆在这里可见、可改、可删：手动编辑/删除即时生效，下一次对话即按新内容注入。
 * 归档（软淘汰）保留审计痕迹但不再进入上下文；删除是彻底移除。
 */
@RestController
@RequestMapping("/api/memories")
public class MemoryController {

    private final MemoryService memoryService;

    public MemoryController(MemoryService memoryService) {
        this.memoryService = memoryService;
    }

    @GetMapping
    public ApiResponse<MemoryListResponse> list() {
        String apiKey = RequestContext.getApiKey();
        List<Memory> items = memoryService.listActive(apiKey);
        return ApiResponse.success(new MemoryListResponse(items,
                Math.min(items.size(), AiPromptBuilder.MAX_MEMORIES), AiPromptBuilder.MAX_MEMORIES));
    }

    /** 手动添加：source=USER，与 AI 提炼的记忆区分来源。 */
    @PostMapping
    public ApiResponse<Memory> create(@Valid @RequestBody MemoryRequest request) {
        return ApiResponse.success(memoryService.create(RequestContext.getApiKey(),
                request.getType() == null || request.getType().isBlank()
                        ? Memory.TYPE_PREFERENCE : request.getType(),
                request.getContent(),
                request.getImportance() == null ? 3 : request.getImportance(),
                Memory.SOURCE_USER, null));
    }

    @PatchMapping("/{id}")
    public ApiResponse<Memory> update(@PathVariable Long id, @Valid @RequestBody MemoryRequest request) {
        return ApiResponse.success(memoryService.update(id, RequestContext.getApiKey(),
                request.getType(), request.getContent(), request.getImportance()));
    }

    /** 归档：不再进入 AI 上下文，但保留记录（可与删除互为撤销空间）。 */
    @PostMapping("/{id}/archive")
    public ApiResponse<Memory> archive(@PathVariable Long id) {
        return ApiResponse.success(memoryService.supersede(id, RequestContext.getApiKey()));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Boolean> delete(@PathVariable Long id) {
        memoryService.delete(id, RequestContext.getApiKey());
        return ApiResponse.success(true);
    }
}
