package com.timetable.service;

import com.timetable.entity.LlmUsage;
import com.timetable.mapper.LlmUsageMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * LLM 用量落库入口（成本治理 P0-1）。
 *
 * <p><b>埋点绝不影响业务</b>：所有异常在这里被吞掉并记日志。理由是计量属于旁路
 * 观测，一旦它抛异常就会把正常的 AI 响应搞挂，代价完全不对等。
 *
 * <p>失败调用也要记录：token 已经花掉但解析失败是真实成本，只记成功会低估开销。
 */
@Service
public class LlmUsageRecorder {

    private static final Logger log = LoggerFactory.getLogger(LlmUsageRecorder.class);

    private final LlmUsageMapper usageMapper;

    public LlmUsageRecorder(LlmUsageMapper usageMapper) {
        this.usageMapper = usageMapper;
    }

    /**
     * 记录一次 LLM 调用。
     *
     * @param apiKey 调用者 api key；为空时跳过（理论上不该发生，交由拦截器保证）
     * @param scene  场景标识，取 {@link LlmUsage} 的 SCENE_* 常量
     * @param status {@link LlmUsage#STATUS_SUCCESS} 或 {@code STATUS_ERROR}
     */
    public void record(String apiKey, String scene, String provider, String model,
                       int promptTokens, int completionTokens,
                       boolean stream, int latencyMs, String status) {
        if (apiKey == null || apiKey.isBlank()) {
            return;
        }
        try {
            LlmUsage usage = new LlmUsage();
            usage.setApiKey(apiKey);
            usage.setScene(scene == null || scene.isBlank() ? LlmUsage.SCENE_UNKNOWN : scene);
            usage.setProvider(provider == null ? "unknown" : provider);
            usage.setModel(model);
            usage.setPromptTokens(Math.max(0, promptTokens));
            usage.setCompletionTokens(Math.max(0, completionTokens));
            usage.setTotalTokens(Math.max(0, promptTokens) + Math.max(0, completionTokens));
            usage.setStream(stream);
            usage.setLatencyMs(Math.max(0, latencyMs));
            usage.setStatus(status);
            usage.setCreatedAt(LocalDateTime.now());
            usageMapper.insert(usage);
        } catch (Exception e) {
            log.warn("记录 LLM 用量失败（已忽略，不影响业务）：{}", e.getClass().getSimpleName());
        }
    }

    public void recordSuccess(String apiKey, String scene, String provider, String model,
                              int promptTokens, int completionTokens, boolean stream, int latencyMs) {
        record(apiKey, scene, provider, model, promptTokens, completionTokens, stream, latencyMs,
                LlmUsage.STATUS_SUCCESS);
    }

    public void recordError(String apiKey, String scene, String provider, String model,
                            int promptTokens, int completionTokens, boolean stream, int latencyMs) {
        record(apiKey, scene, provider, model, promptTokens, completionTokens, stream, latencyMs,
                LlmUsage.STATUS_ERROR);
    }
}