package com.timetable.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;

/**
 * 桌面版（standalone）把前端构建产物打进 jar 的 {@code classpath:/static/}，
 * 并让 React Router 的前端路由（{@code /todos}、{@code /manual}、{@code /widget} 等）
 * 被直接访问时不返回 404 —— 找不到对应静态文件就回退到 {@code index.html}。
 *
 * <p>仅在 standalone profile 生效：开发时前端由 Vite 提供，这里不应插手。
 * 资源处理器是最后兜底，因此 {@code /api/**} 仍由各 Controller 正常处理；
 * 未知的 API 路径继续返回 404，不会被伪装成前端页面。
 */
@Configuration
@Profile("standalone")
public class SpaWebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location) throws IOException {
                        Resource requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) {
                            return requested;
                        }
                        if (resourcePath.startsWith("api/")) {
                            return null;
                        }
                        Resource index = new ClassPathResource("/static/index.html");
                        return index.exists() ? index : null;
                    }
                });
    }
}
