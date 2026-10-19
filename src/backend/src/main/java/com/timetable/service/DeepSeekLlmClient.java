package com.timetable.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.DeepSeekProperties;
import com.timetable.service.impl.DeepSeekKeyStore;
import org.springframework.stereotype.Service;

/**
 * DeepSeek 适配器（AI Campus Agent V1.0）。
 *
 * <p>协议相关的部分全部在 {@link AbstractOpenAiLlmClient} 里，这里只负责回答
 * 「模型叫什么、Key 从哪来、超时多久」——即 DeepSeek 与通用兼容服务唯一的差别。
 *
 * <p>Key 的取值优先级仍是：界面本地设置 → 配置项/环境变量，见 {@link DeepSeekKeyStore}。
 */
@Service
public class DeepSeekLlmClient extends AbstractOpenAiLlmClient {

    private final DeepSeekProperties properties;
    private final DeepSeekKeyStore keyStore;

    public DeepSeekLlmClient(DeepSeekProperties properties, DeepSeekKeyStore keyStore,
                             ObjectMapper objectMapper, LlmUsageRecorder usageRecorder) {
        super(objectMapper, usageRecorder);
        this.properties = properties;
        this.keyStore = keyStore;
    }

    @Override
    public String providerId() {
        return LlmClientRegistry.DEEPSEEK;
    }

    @Override
    public boolean isConfigured() {
        return keyStore.isConfigured();
    }

    @Override
    protected String baseUrl() {
        return properties.getBaseUrl();
    }

    @Override
    protected String apiKey() {
        return keyStore.effectiveKey();
    }

    @Override
    protected String model() {
        return properties.getModel();
    }

    @Override
    protected double temperature() {
        return properties.getTemperature();
    }

    @Override
    protected int maxTokens() {
        return properties.getMaxTokens();
    }

    @Override
    protected String reasoningEffort() {
        return properties.getReasoningEffort();
    }

    @Override
    protected int timeoutSeconds() {
        return properties.getTimeoutSeconds();
    }

    @Override
    protected int idleTimeoutSeconds() {
        return properties.getIdleTimeoutSeconds();
    }
}
