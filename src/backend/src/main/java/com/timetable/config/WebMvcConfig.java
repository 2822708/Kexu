package com.timetable.config;

import com.timetable.interceptor.ApiKeyInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final ApiKeyInterceptor apiKeyInterceptor;

    public WebMvcConfig(ApiKeyInterceptor apiKeyInterceptor) {
        this.apiKeyInterceptor = apiKeyInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 只放行身份验证与设备注册，业务接口仍使用设备/现有账号凭据鉴权。
        // /api/widget/** 不再豁免：把 Key 放在 URL 路径里会让凭据进入访问日志与 Referer，
        // 小组件页改为和其它接口一样用 X-API-Key 请求头。
        // /api/health 必须豁免：容器平台的存活探针没法带 Key，需要它做健康检查。
        registry.addInterceptor(apiKeyInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/verify", "/api/auth/device", "/api/health");
    }
}
