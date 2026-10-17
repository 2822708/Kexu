package com.timetable.service;

import com.timetable.config.LlmProperties;
import com.timetable.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * LLM 提供方注册表（AI Campus Agent V1.0）。
 *
 * 所有 {@link LlmClient} 实现由 Spring 收集为本表的候选；{@link #active()} 按
 * {@code app.llm.active-provider} 选择当前客户端：
 * - 激活项已注册且已配置 → 直接使用；
 * - 激活项未注册（配置错误）或未配置 API Key → 回退到任一已注册且已配置的客户端，
 *   保证「换模型/加模型」只改配置、不中断功能；
 * - 全部不可用 → 抛出 503，由调用方转换为降级文案。
 */
@Component
public class LlmClientRegistry {

    private static final Logger log = LoggerFactory.getLogger(LlmClientRegistry.class);

    public static final String DEEPSEEK = "deepseek";

    private final Map<String, LlmClient> clients;
    private final LlmProperties properties;
    private final LlmBudgetService budget;

    public LlmClientRegistry(List<LlmClient> clients, LlmProperties properties,
                             LlmBudgetService budget) {
        Map<String, LlmClient> collected = new LinkedHashMap<>();
        for (LlmClient client : clients) {
            collected.put(client.providerId(), client);
        }
        this.clients = Collections.unmodifiableMap(collected);
        this.properties = properties;
        this.budget = budget;
        String configured = normalize(properties.getActiveProvider());
        if (!this.clients.containsKey(configured)) {
            log.warn("app.llm.active-provider={} 未注册，已注册的 provider：{}；将按可用性回退",
                    configured, this.clients.keySet());
        }
    }

    /**
     * 当前激活的客户端；全部未配置时抛出 503（AI 功能不可用）。
     *
     * <p>返回值统一包一层 {@link BudgetAwareLlmClient}：预算拦截因此对所有 provider
     * 生效，未来接第二个模型不需要重做一遍。包的是「调用前检查」，超限的调用
     * 一次 token 都不会花。
     */
    public LlmClient active() {
        String configured = normalize(properties.getActiveProvider());
        LlmClient chosen = clients.get(configured);
        if (chosen != null && chosen.isConfigured()) {
            return new BudgetAwareLlmClient(chosen, budget);
        }
        for (Map.Entry<String, LlmClient> entry : clients.entrySet()) {
            if (entry.getValue().isConfigured()) {
                return new BudgetAwareLlmClient(entry.getValue(), budget);
            }
        }
        throw new BusinessException(503, "AI 服务未配置或暂时不可用，请稍后再试");
    }

    /** AI 功能是否可用（激活或回退的客户端已配置）。 */
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

    private String normalize(String providerId) {
        if (providerId == null || providerId.isBlank()) {
            return DEEPSEEK;
        }
        String id = providerId.trim().toLowerCase();
        // legacy-direct 是回滚开关：V1.0 只有 deepseek 一个实现，两者等价
        return LlmProperties.LEGACY_DIRECT.equals(id) ? DEEPSEEK : id;
    }
}
