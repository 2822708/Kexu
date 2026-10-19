package com.timetable.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.LlmProperties;
import com.timetable.config.LlmProviderConfig;
import com.timetable.exception.BusinessException;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * LLM 提供方注册表（AI Campus Agent V1.0）。
 *
 * <p>候选来自两处：Spring 容器里的 {@link LlmClient} bean（DeepSeek 等内置实现），
 * 以及 {@code app.llm.providers.*} 配置出来的 OpenAI 兼容 provider。后者数量由
 * 配置决定，无法用 {@code @Bean} 静态声明，因此在这里按配置实例化并负责释放。
 *
 * <p>取客户端的两条路径：
 * <ul>
 *   <li>{@link #active()}：默认 provider（向后兼容的既有入口）。</li>
 *   <li>{@link #forScene(String)}：按场景路由——把「意图分类、简单抽取」这类轻活
 *       指向便宜的 flash 级模型，重活留在主力模型上。未配置路由的场景等价于
 *       {@link #active()}。</li>
 * </ul>
 *
 * <p>选择规则：指定的 provider 已注册且已配置则直接用；否则回退到任一已配置的
 * 客户端，保证「换模型/加模型」只改配置、不中断功能；全部不可用则抛 503。
 *
 * <p>返回值统一包两层：外层 {@link BudgetAwareLlmClient}（调用前检查预算，超限的
 * 调用一次 token 都不会花），内层 {@link FallbackLlmClient}（主 provider 失败
 * 自动切备用）。两个装饰器对所有 provider 生效，新增 provider 不需要重做一遍。
 */
@Component
public class LlmClientRegistry {

    private static final Logger log = LoggerFactory.getLogger(LlmClientRegistry.class);

    public static final String DEEPSEEK = "deepseek";

    private final Map<String, LlmClient> clients;
    private final LlmProperties properties;
    private final LlmBudgetService budget;
    /** 配置驱动的 provider，容器关闭时统一释放其看门狗线程。 */
    private final List<AbstractOpenAiLlmClient> dynamicClients;

    public LlmClientRegistry(List<LlmClient> clients, LlmProperties properties,
                             LlmBudgetService budget,
                             ObjectProvider<ObjectMapper> objectMapperProvider,
                             ObjectProvider<LlmUsageRecorder> usageRecorderProvider) {
        Map<String, LlmClient> collected = new LinkedHashMap<>();
        for (LlmClient client : clients) {
            collected.put(client.providerId(), client);
        }
        this.dynamicClients = new ArrayList<>();
        Map<String, LlmProviderConfig> configured = properties.getProviders();
        if (configured != null && !configured.isEmpty()) {
            // 只有真的配了 provider 才去取这两个 bean：精简的测试上下文里没有
            // LlmUsageMapper，硬依赖会让整个容器起不来（既有 12 个测试就是这么挂的）。
            ObjectMapper objectMapper = objectMapperProvider.getIfAvailable();
            LlmUsageRecorder usageRecorder = usageRecorderProvider.getIfAvailable();
            if (objectMapper == null || usageRecorder == null) {
                log.warn("已配置 {} 个 provider，但 ObjectMapper / LlmUsageRecorder 不可用，跳过动态 provider",
                        configured.size());
            } else {
                for (Map.Entry<String, LlmProviderConfig> entry : configured.entrySet()) {
                    String id = normalize(entry.getKey());
                    if (collected.containsKey(id)) {
                        log.warn("app.llm.providers.{} 与内置 provider 重名，已忽略配置项", id);
                        continue;
                    }
                    OpenAiCompatibleLlmClient created =
                            new OpenAiCompatibleLlmClient(id, entry.getValue(), objectMapper, usageRecorder);
                    collected.put(id, created);
                    this.dynamicClients.add(created);
                }
            }
        }
        this.clients = Collections.unmodifiableMap(collected);
        this.properties = properties;
        this.budget = budget;
        String configuredActive = normalize(properties.getActiveProvider());
        if (!this.clients.containsKey(configuredActive)) {
            log.warn("app.llm.active-provider={} 未注册，已注册的 provider：{}；将按可用性回退",
                    configuredActive, this.clients.keySet());
        }
    }

    /** 默认客户端；全部未配置时抛 503（AI 功能不可用）。 */
    public LlmClient active() {
        return forScene(null);
    }

    /**
     * 按场景取客户端（成本治理 6.1：任务分级路由）。
     *
     * <p>{@code app.llm.routes.<SCENE>=<providerId>} 命中就用指定的 provider，
     * 未命中走 {@code active-provider}。场景常量见
     * {@link com.timetable.entity.LlmUsage} 的 {@code SCENE_*}。
     */
    public LlmClient forScene(String scene) {
        String routed = scene == null ? null : resolveRoute(scene);
        String primaryId = routed != null ? routed : normalize(properties.getActiveProvider());
        return wrap(primaryId);
    }

    /** AI 功能是否可用（任一已注册的客户端已配置）。 */
    public boolean isActiveConfigured() {
        for (LlmClient client : clients.values()) {
            if (client.isConfigured()) {
                return true;
            }
        }
        return false;
    }

    /** 当前实际使用的 providerId（仅用于日志与排查）。 */
    public String activeProviderId() {
        try {
            return active().providerId();
        } catch (BusinessException unavailable) {
            return normalize(properties.getActiveProvider());
        }
    }

    /** 已注册的 providerId（供设置页/排查用）。 */
    public List<String> registeredProviders() {
        return List.copyOf(clients.keySet());
    }

    private String resolveRoute(String scene) {
        Map<String, String> routes = properties.getRoutes();
        if (routes == null || routes.isEmpty() || scene == null) {
            return null;
        }
        String hit = routes.get(scene);
        if (hit == null || hit.isBlank()) {
            // 配置里大小写写错不该让路由静默失效，做一次大小写不敏感的兜底匹配
            for (Map.Entry<String, String> entry : routes.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(scene)
                        && entry.getValue() != null && !entry.getValue().isBlank()) {
                    hit = entry.getValue();
                    break;
                }
            }
        }
        return hit == null || hit.isBlank() ? null : normalize(hit);
    }

    private LlmClient wrap(String primaryId) {
        List<LlmClient> chain = new ArrayList<>();
        LlmClient primary = clients.get(normalize(primaryId));
        if (primary != null && primary.isConfigured()) {
            chain.add(primary);
        }
        if (properties.isFallbackEnabled()) {
            List<String> backups = properties.getFallback();
            if (backups != null) {
                for (String id : backups) {
                    LlmClient candidate = clients.get(normalize(id));
                    if (candidate != null && candidate.isConfigured() && !chain.contains(candidate)) {
                        chain.add(candidate);
                    }
                }
            }
        }
        if (chain.isEmpty()) {
            // 指定的 provider 不可用：回退到任一已配置的，避免「改了配置就全站 503」
            for (LlmClient candidate : clients.values()) {
                if (candidate.isConfigured()) {
                    chain.add(candidate);
                    break;
                }
            }
        }
        if (chain.isEmpty()) {
            throw new BusinessException(503, "AI 服务未配置或暂时不可用，请稍后再试");
        }
        LlmClient core = chain.size() == 1 ? chain.get(0) : new FallbackLlmClient(chain);
        return new BudgetAwareLlmClient(core, budget);
    }

    private String normalize(String providerId) {
        if (providerId == null || providerId.isBlank()) {
            return DEEPSEEK;
        }
        String id = providerId.trim().toLowerCase(Locale.ROOT);
        // legacy-direct 是回滚开关：V1.0 只有 deepseek 一个实现，两者等价
        return LlmProperties.LEGACY_DIRECT.equals(id) ? DEEPSEEK : id;
    }

    @PreDestroy
    public void shutdownDynamicClients() {
        for (AbstractOpenAiLlmClient client : dynamicClients) {
            client.shutdownWatchdog();
        }
    }
}
