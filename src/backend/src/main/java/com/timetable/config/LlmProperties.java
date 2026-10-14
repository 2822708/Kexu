package com.timetable.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * AI Campus Agent 的 LLM 提供方配置。
 *
 * active-provider 决定默认使用哪个已注册的 {@code LlmClient}；
 * 取 "legacy-direct" 时退回 DeepSeek 直连路径（与原实现等价，作为回滚开关）。
 */
@Component
@ConfigurationProperties(prefix = "app.llm")
public class LlmProperties {

    /** 回滚开关：与原 DeepSeek 直连调用等价（V1.0 仅注册了 deepseek）。 */
    public static final String LEGACY_DIRECT = "legacy-direct";

    private String activeProvider = "deepseek";

    public String getActiveProvider() { return activeProvider; }
    public void setActiveProvider(String activeProvider) { this.activeProvider = activeProvider; }
}
