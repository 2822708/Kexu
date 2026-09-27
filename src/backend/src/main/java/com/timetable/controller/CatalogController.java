package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.CatalogViews;
import com.timetable.dto.PageResult;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.CatalogReadService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@RestController
public class CatalogController {

    private final CatalogReadService catalogReadService;

    public CatalogController(CatalogReadService catalogReadService) {
        this.catalogReadService = catalogReadService;
    }

    @GetMapping("/api/schedules/page")
    public ApiResponse<PageResult<CatalogViews.ScheduleView>> schedules(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return ApiResponse.success(catalogReadService.schedules(
                RequestContext.getApiKey(), search, page, pageSize));
    }

    @GetMapping("/api/schedules/{scheduleId}/courses/page")
    public ApiResponse<PageResult<CatalogViews.CourseView>> courses(
            @PathVariable Long scheduleId,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Integer dayOfWeek,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return ApiResponse.success(catalogReadService.courses(scheduleId,
                RequestContext.getApiKey(), search, dayOfWeek, page, pageSize));
    }

    @GetMapping("/api/schedules/{scheduleId}/exams/page")
    public ApiResponse<PageResult<CatalogViews.ExamView>> exams(
            @PathVariable Long scheduleId,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return ApiResponse.success(catalogReadService.exams(scheduleId,
                RequestContext.getApiKey(), search, from, to, page, pageSize));
    }

    @GetMapping("/api/todos/page")
    public ApiResponse<PageResult<CatalogViews.TodoView>> todos(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Boolean completed,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return ApiResponse.success(catalogReadService.todos(
                RequestContext.getApiKey(), search, completed, page, pageSize));
    }

    @GetMapping("/api/recurring-todos/page")
    public ApiResponse<PageResult<CatalogViews.RecurringView>> recurring(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return ApiResponse.success(catalogReadService.recurring(
                RequestContext.getApiKey(), search, enabled, page, pageSize));
    }
}
