package com.timetable.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.LlmProviderConfig;

/**
 * 配置驱动的 OpenAI 兼容客户端（成本治理 6.1：多 provider）。
 *
 * <p>智谱 GLM、通义千问、豆包、Moonshot 以及自建的 OpenAI 兼容网关都走同一套
 * chat/completions，所以不需要为每家写一个类——填 {@code app.llm.providers.<id>}
 * 即可挂上来，providerId 就是配置里的键名。
 *
 * <p>本类不由 Spring 直接管理（数量由配置决定），由 {@link LlmProviderFactory}
 * 创建并在容器关闭时统一释放看门狗线程。
 */
public class OpenAiCompatibleLlmClient extends AbstractOpenAiLlmClient {

    private final String providerId;
    private final LlmProviderConfig config;

    public OpenAiCompatibleLlmClient(String providerId, LlmProviderConfig config,
                                     ObjectMapper objectMapper, LlmUsageRecorder usageRecorder) {
        super(objectMapper, usageRecorder);
        this.providerId = providerId;
        this.config = config;
    }

    @Override
    public String providerId() {
        return providerId;
    }

    @Override
    public boolean isConfigured() {
        return config != null && config.isComplete();
    }

    @Override
    protected String baseUrl() {
        return config.getBaseUrl();
    }

    @Override
    protected String apiKey() {
        return config.getApiKey();
    }

    @Override
    protected String model() {
        return config.getModel();
    }

    @Override
    protected double temperature() {
        return config.getTemperature();
    }

    @Override
    protected int maxTokens() {
        return config.getMaxTokens();
    }

    @Override
    protected String reasoningEffort() {
        return config.getReasoningEffort();
    }

    @Override
    protected int timeoutSeconds() {
        return config.getTimeoutSeconds();
    }

    @Override
    protected int idleTimeoutSeconds() {
        return config.getIdleTimeoutSeconds();
    }
}
