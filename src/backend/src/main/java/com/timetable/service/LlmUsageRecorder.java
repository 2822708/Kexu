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
            /*
             * 理论上不该发生（拦截器保证），但一旦发生就是静默丢数据：整个场景的
             * 成本在统计页上凭空消失，而且没有任何报错。
             *
             * 实测踩过一次：SSE 流式对话跑在 streamExecutor 的工作线程上，
             * RequestContext（ThreadLocal）取不到身份 → 对话场景零计量。
             * 所以这里必须留声，不能默默 return。
             */
            log.warn("记录 LLM 用量失败：调用方身份为空（scene={}），这条用量不会计入统计", scene);
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