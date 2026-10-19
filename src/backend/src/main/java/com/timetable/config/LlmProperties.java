package com.timetable.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI Campus Agent 的 LLM 提供方与路由配置。
 *
 * <p>{@code active-provider} 决定默认使用哪个已注册的 {@code LlmClient}；
 * 取 "legacy-direct" 时退回 DeepSeek 直连路径（与原实现等价，作为回滚开关）。
 *
 * <p>成本治理 6.1 扩展了两块能力，都是配置驱动、业务代码零改动：
 * <ul>
 *   <li><b>providers</b>：除 DeepSeek 外再挂任意数量的 OpenAI 兼容服务
 *       （智谱 GLM / 通义 / 豆包 / 自建网关）。Key 留空即视为未配置、不参与调度。</li>
 *   <li><b>routes</b>：按场景（{@code CHAT / PLAN / EXTRACT / OCR / INBOX / QUERY / REFINE /
 *       PARSE_HTML}）指定 provider，把「意图分类、简单抽取」这类轻活切到便宜的 flash 级模型，
 *       重活留在主力模型上。</li>
 *   <li><b>fallback</b>：主 provider 调用失败时的备用链，按顺序尝试一次。</li>
 * </ul>
 */
@Component
@ConfigurationProperties(prefix = "app.llm")
public class LlmProperties {

    /** 回滚开关：与原 DeepSeek 直连调用等价（V1.0 仅注册了 deepseek）。 */
    public static final String LEGACY_DIRECT = "legacy-direct";

    private String activeProvider = "deepseek";

    /** providerId -> 连接参数。DeepSeek 走既有 {@code deepseek.api.*}，不在这里配。 */
    private Map<String, LlmProviderConfig> providers = new LinkedHashMap<>();

    /** 场景 -> providerId。未列出的场景走 {@code active-provider}。 */
    private Map<String, String> routes = new LinkedHashMap<>();

    /** 故障降级链（providerId 有序列表）。为空表示不降级。 */
    private List<String> fallback = new ArrayList<>();

    /**
     * 是否在 provider 调用失败时自动切备用。默认开启：多配一个 provider 的目的
     * 就是消除单点故障；只有排查问题时才需要关掉（关掉后失败行为与 V1.0 完全一致）。
     */
    private boolean fallbackEnabled = true;

    /**
     * 生成类调用（当前只有每日计划）在模型输出不合规时的重试策略。
     *
     * <p>与 {@code fallback} 是两件事：fallback 处理的是「provider 挂了」，发生在
     * {@code LlmClient} 内部；plan-retry 处理的是「provider 正常，但模型这次输出没通过
     * 服务端校验」，发生在业务层。两者叠加时顺序是「先业务重试，再换 provider，再业务重试」。
     */
    private PlanRetry planRetry = new PlanRetry();

    public String getActiveProvider() { return activeProvider; }

    public PlanRetry getPlanRetry() { return planRetry; }
    public void setPlanRetry(PlanRetry planRetry) {
        this.planRetry = planRetry == null ? new PlanRetry() : planRetry;
    }
    public void setActiveProvider(String activeProvider) { this.activeProvider = activeProvider; }

    public Map<String, LlmProviderConfig> getProviders() { return providers; }
    public void setProviders(Map<String, LlmProviderConfig> providers) {
        this.providers = providers == null ? new LinkedHashMap<>() : providers;
    }

    public Map<String, String> getRoutes() { return routes; }
    public void setRoutes(Map<String, String> routes) {
        this.routes = routes == null ? new LinkedHashMap<>() : routes;
    }

    public List<String> getFallback() { return fallback; }
    public void setFallback(List<String> fallback) {
        this.fallback = fallback == null ? new ArrayList<>() : fallback;
    }

    public boolean isFallbackEnabled() { return fallbackEnabled; }
    public void setFallbackEnabled(boolean fallbackEnabled) { this.fallbackEnabled = fallbackEnabled; }

    /**
     * 计划生成的重试退避参数（成本治理 6.1 #6）。
     *
     * <p>只对**可重试失败**生效——即模型输出没通过服务端校验（502）、上游超时/繁忙
     * （503/504）、网络异常。模板缺失（500）、未配置 provider（503 但无 provider 可用）、
     * 数据库写失败这类重试一百次也不会变的错误一律直接抛，不做无意义等待。
     *
     * <p>退避是指数式的：{@code initial-backoff-ms * 2^attempt}，再加最多
     * {@code jitter-ms} 的随机抖动。抖动的作用是避免多个用户的失败请求在上游恢复的
     * 同一瞬间齐刷刷打过去，把上游再打死一次。
     */
    public static class PlanRetry {

        /** 总尝试次数（含首次）。默认 3 = 首轮 + 重试 2 次。 */
        private int maxAttempts = 3;

        /** 首次重试前的等待毫秒数。默认 800ms。 */
        private long initialBackoffMs = 800L;

        /** 单次等待上限，防止指数退避把请求拖到前端超时。默认 4000ms。 */
        private long maxBackoffMs = 4000L;

        /** 抖动上限（毫秒）。默认 300ms。 */
        private long jitterMs = 300L;

        /** 关掉即退化为 V1.0 行为：一次失败直接冒到前端。 */
        private boolean enabled = true;

        public int getMaxAttempts() { return maxAttempts; }
        public void setMaxAttempts(int maxAttempts) { this.maxAttempts = maxAttempts; }

        public long getInitialBackoffMs() { return initialBackoffMs; }
        public void setInitialBackoffMs(long initialBackoffMs) { this.initialBackoffMs = initialBackoffMs; }

        public long getMaxBackoffMs() { return maxBackoffMs; }
        public void setMaxBackoffMs(long maxBackoffMs) { this.maxBackoffMs = maxBackoffMs; }

        public long getJitterMs() { return jitterMs; }
        public void setJitterMs(long jitterMs) { this.jitterMs = jitterMs; }

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
    }
}
