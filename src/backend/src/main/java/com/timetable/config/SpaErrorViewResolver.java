package com.timetable.config;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.boot.autoconfigure.web.servlet.error.ErrorViewResolver;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.ModelAndView;

/**
 * 单机版（standalone profile）SPA 路由兜底。
 *
 * <p>Spring Boot 静态托管只认识真实文件：用户直接访问 /info、/todos 这类前端路由时
 * 会得到 404。桌面版由本服务同时提供 API 与前端产物，所以把 404 转发到 index.html，
 * 剩下的路由交给 react-router。
 *
 * <p>两个刻意的边界：① /api 开头的 404 保持原样——API 路径拼错应该看到 404 JSON，
 * 而不是一屏安静的 HTML，那会让前端的错误处理无法解释；② 只在 GET 上兜底，
 * POST/PUT 的 404 是真实的接口错误。
 */
@Component
public class SpaErrorViewResolver implements ErrorViewResolver {

    @Override
    public ModelAndView resolveErrorView(
            HttpServletRequest request, HttpStatus status, Map<String, Object> model) {
        boolean isGet = "GET".equalsIgnoreCase(request.getMethod());
        boolean isApi = request.getRequestURI().startsWith("/api");
        if (status == HttpStatus.NOT_FOUND && isGet && !isApi) {
            return new ModelAndView("forward:/index.html");
        }
        return null;
    }
}
