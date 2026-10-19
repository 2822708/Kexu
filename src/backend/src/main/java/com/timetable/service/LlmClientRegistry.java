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
import java.util.Objects;

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
    /** 界面配置的 provider（本地设置），保存后无需重启即可生效。 */
    private final LlmProviderSettings providerSettings;
    private final ObjectMapper objectMapper;
    private final LlmUsageRecorder usageRecorder;
    /** 当前动态客户端对应的配置指纹；变化时重建。 */
    private volatile String dynamicVersion;
    /** 重建动态客户端期间的互斥，避免并发请求重复建客户端 + 泄漏看门狗线程。 */
    private final Object rebuildLock = new Object();

    public LlmClientRegistry(List<LlmClient> clients, LlmProperties properties,
                             LlmBudgetService budget,
                             ObjectProvider<LlmProviderSettings> providerSettingsProvider,
                             ObjectProvider<ObjectMapper> objectMapperProvider,
                             ObjectProvider<LlmUsageRecorder> usageRecorderProvider) {
        Map<String, LlmClient> collected = new LinkedHashMap<>();
        for (LlmClient client : clients) {
            String id = client == null ? null : client.providerId();
            if (id == null || id.isBlank()) {
                // providerId 是实现类的契约，正常实现不会为空。但**不能因此丢掉这个 client**：
                // 丢掉等于「AI 突然不可用」，比 id 难看严重得多。给个稳定的占位 id 继续用，
                // 同时告警——注意 null 也不能进 map，后面 List.copyOf(keys) 会直接 NPE。
                if (client == null) {
                    continue;
                }
                id = DEEPSEEK;
                log.warn("LlmClient {} 未返回 providerId，按 {} 处理（请检查实现）",
                        client.getClass().getName(), id);
            }
            collected.putIfAbsent(id, client);
        }
        this.dynamicClients = new ArrayList<>();
        this.properties = properties;
        this.budget = budget;
        // 用 ObjectProvider 取：精简的测试上下文（12 个）只 Import 了 LlmClientRegistry，
        // 没有本地设置也照样要能起容器。硬依赖会让整个测试套件一次挂掉 81 个用例。
        this.providerSettings = providerSettingsProvider.getIfAvailable();
        // 只有真的配了 provider 才去取这两个 bean：精简的测试上下文里没有
        // LlmUsageMapper，硬依赖会让整个容器起不来（既有 12 个测试就是这么挂的）。
        this.objectMapper = objectMapperProvider.getIfAvailable();
        this.usageRecorder = usageRecorderProvider.getIfAvailable();
        this.clients = Collections.unmodifiableMap(collected);
        rebuildDynamicClients();

        String configuredActive = normalize(properties.getActiveProvider());
        if (!this.clients.containsKey(configuredActive)) {
            log.warn("app.llm.active-provider={} 未注册，已注册的 provider：{}；将按可用性回退",
                    configuredActive, this.clients.keySet());
        }
        logProviders("启动");
    }

    /**
     * 按当前配置重建动态 provider，并返回可用的 providerId 集合。
     *
     * <p>并发保护：多个请求同时发现配置变了，只让一个真建，其余直接用结果——
     * 否则每次重建都会创建新的 HTTP 客户端与看门狗线程，旧的没人关，越跑线程越多。
     */
    private Map<String, LlmClient> refreshDynamicClients() {
        String version = providerSettings == null ? "" : providerSettings.version();
        if (Objects.equals(version, dynamicVersion)) {
            return mergedClients();
        }
        synchronized (rebuildLock) {
            if (Objects.equals(version, dynamicVersion)) {
                return mergedClients(); // 别人已经重建过了
            }
            rebuildDynamicClients();
            return mergedClients();
        }
    }

    private void rebuildDynamicClients() {
        Map<String, LlmProviderConfig> configured =
                providerSettings == null ? properties.getProviders() : providerSettings.snapshot();
        String version = providerSettings == null ? "" : providerSettings.version();

        // 先关旧的再建新的：配置改一次就换一批线程，不关会一直累积
        for (AbstractOpenAiLlmClient stale : dynamicClients) {
            stale.shutdownWatchdog();
        }
        dynamicClients.clear();

        if (configured != null && !configured.isEmpty()) {
            if (objectMapper == null || usageRecorder == null) {
                log.warn("已配置 {} 个 provider，但 ObjectMapper / LlmUsageRecorder 不可用，跳过动态 provider",
                        configured.size());
            } else {
                for (Map.Entry<String, LlmProviderConfig> entry : configured.entrySet()) {
                    String id = normalize(entry.getKey());
                    if (clients.containsKey(id)) {
                        log.warn("provider {} 与内置 provider 重名，已忽略配置项", id);
                        continue;
                    }
                    OpenAiCompatibleLlmClient created =
                            new OpenAiCompatibleLlmClient(id, entry.getValue(), objectMapper, usageRecorder);
                    dynamicClients.add(created);
                }
            }
        }
        this.dynamicVersion = version;
        if (version.isEmpty()) {
            this.dynamicVersion = "";
        }
    }

    /** 内置 + 动态的合并视图（每次读都取当前状态，不在构造时冻结）。 */
    private Map<String, LlmClient> mergedClients() {
        if (dynamicClients.isEmpty()) {
            return clients;
        }
        Map<String, LlmClient> merged = new LinkedHashMap<>(clients);
        for (AbstractOpenAiLlmClient dynamic : dynamicClients) {
            merged.put(dynamic.providerId(), dynamic);
        }
        return Collections.unmodifiableMap(merged);
    }

    private void logProviders(String phase) {
        Map<String, LlmClient> view = mergedClients();
        List<String> ready = new ArrayList<>();
        for (Map.Entry<String, LlmClient> entry : view.entrySet()) {
            if (entry.getValue().isConfigured()) {
                ready.add(entry.getKey());
            }
        }
        log.info("LLM providers [{}] registered={} ready={} routes={} fallback={}",
                phase, view.keySet(), ready,
                properties.getRoutes() == null ? Map.of() : properties.getRoutes(),
                properties.getFallback() == null ? List.of() : properties.getFallback());
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
        for (LlmClient client : refreshDynamicClients().values()) {
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
        return List.copyOf(refreshDynamicClients().keySet());
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
        // 在这里刷新而不是在构造时冻结：用户在设置页刚填的 provider 要能立刻用上
        Map<String, LlmClient> available = refreshDynamicClients();
        List<LlmClient> chain = new ArrayList<>();
        LlmClient primary = available.get(normalize(primaryId));
        if (primary != null && primary.isConfigured()) {
            chain.add(primary);
        }
        if (properties.isFallbackEnabled()) {
            List<String> backups = properties.getFallback();
            if (backups != null) {
                for (String id : backups) {
                    LlmClient candidate = available.get(normalize(id));
                    if (candidate != null && candidate.isConfigured() && !chain.contains(candidate)) {
                        chain.add(candidate);
                    }
                }
            }
        }
        if (chain.isEmpty()) {
            // 指定的 provider 不可用：回退到任一已配置的，避免「改了配置就全站 503」
            for (LlmClient candidate : available.values()) {
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
