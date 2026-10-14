package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.DashboardDto;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.DashboardService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * AI Dashboard 聚合端点（AI Campus Agent V1.0 Step 5）。
 *
 * 一次请求返回首页全部数据，替代前端 N 次串行：
 * 档案 + 今日课程 + 今日任务 + 48h 截止 + 考试倒计时 + 规则计算的今日重点。
 */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping
    public ApiResponse<DashboardDto> dashboard(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(required = false) Long scheduleId) {
        return ApiResponse.success(
                dashboardService.dashboard(date, scheduleId, RequestContext.getApiKey()));
    }
}
