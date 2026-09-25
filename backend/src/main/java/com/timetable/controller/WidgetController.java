package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.WidgetService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 桌面小组件展示接口（只读）。
 * 由桌面小组件（WebView 组件）加载只读展示页，每 60 秒轮询一次，
 * 每次请求都实时聚合最新数据返回。
 *
 * 凭据与其它接口一致：走 {@code X-API-Key} 请求头，由 {@link com.timetable.interceptor.ApiKeyInterceptor}
 * 统一校验。此前 Key 走 URL 路径（{@code /overview/{key}}），会让凭据落入 nginx 访问日志、
 * 浏览器历史与 Referer，因此已改为请求头。
 */
@RestController
@RequestMapping("/api/widget")
public class WidgetController {

    private final WidgetService widgetService;

    public WidgetController(WidgetService widgetService) {
        this.widgetService = widgetService;
    }

    @GetMapping(value = "/overview", produces = "application/json;charset=utf-8")
    public ApiResponse<Map<String, Object>> overview(
            @RequestParam(value = "scheduleId", required = false) Long scheduleId,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(widgetService.overview(RequestContext.getApiKey(), scheduleId));
    }
}
