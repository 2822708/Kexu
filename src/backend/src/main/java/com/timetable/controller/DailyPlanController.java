package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.DailyPlanDto;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.DailyPlanService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.Map;

/**
 * AI 每日计划端点（AI Campus Agent V1.0 Step 6）。
 *
 * GET 只读缓存（首页加载永不烧 token）；POST 触发生成，同一天第二次调用命中缓存。
 */
@RestController
@RequestMapping("/api/plans")
public class DailyPlanController {

    private final DailyPlanService dailyPlanService;

    public DailyPlanController(DailyPlanService dailyPlanService) {
        this.dailyPlanService = dailyPlanService;
    }

    @GetMapping("/daily")
    public ApiResponse<DailyPlanDto> get(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(dailyPlanService.get(RequestContext.getApiKey(), date));
    }

    /**
     * 生成当日计划：命中缓存直接返回；否则调用模型生成、服务端校验后落库。
     * body 可选 { "date": "yyyy-MM-dd", "scheduleId": 123 }。
     */
    @PostMapping("/daily")
    public ApiResponse<DailyPlanDto> generate(@RequestBody(required = false) Map<String, Object> body) {
        LocalDate date = null;
        Long scheduleId = null;
        if (body != null) {
            Object rawDate = body.get("date");
            if (rawDate != null && !String.valueOf(rawDate).isBlank()) {
                date = LocalDate.parse(String.valueOf(rawDate).trim());
            }
            Object rawSchedule = body.get("scheduleId");
            if (rawSchedule != null && !String.valueOf(rawSchedule).isBlank()) {
                scheduleId = Long.valueOf(String.valueOf(rawSchedule).trim());
            }
        }
        return ApiResponse.success(
                dailyPlanService.generate(RequestContext.getApiKey(), scheduleId, date));
    }
}
