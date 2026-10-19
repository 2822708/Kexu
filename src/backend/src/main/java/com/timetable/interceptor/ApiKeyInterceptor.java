package com.timetable.interceptor;

import com.timetable.mapper.ApiKeyMapper;
import com.timetable.service.DailyActiveRecorder;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class ApiKeyInterceptor implements HandlerInterceptor {

    private final ApiKeyMapper apiKeyMapper;
    private final DailyActiveRecorder activeRecorder;

    public ApiKeyInterceptor(ApiKeyMapper apiKeyMapper, DailyActiveRecorder activeRecorder) {
        this.apiKeyMapper = apiKeyMapper;
        this.activeRecorder = activeRecorder;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey == null || apiKey.isBlank()) {
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            try {
                response.getWriter().write("{\"code\":401,\"message\":\"缺少 X-API-Key 请求头\",\"data\":null}");
            } catch (Exception ignored) {
            }
            return false;
        }
        if (apiKeyMapper.selectById(apiKey) == null) {
            response.setStatus(401);
            response.setContentType("application/json;charset=UTF-8");
            try {
                response.getWriter().write("{\"code\":401,\"message\":\"API Key 无效\",\"data\":null}");
            } catch (Exception ignored) {
            }
            return false;
        }
        RequestContext.setApiKey(apiKey);
        // 留存口径：这个人今天来过没有。同一天只写一条，不产生额外查询（见 DailyActiveRecorder）。
        activeRecorder.touch(apiKey);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        RequestContext.clear();
    }
}
