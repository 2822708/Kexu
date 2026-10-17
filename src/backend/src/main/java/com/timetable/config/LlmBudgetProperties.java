package com.timetable.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * LLM 月度预算配置（成本治理 P0-2）。
 *
 * <p><b>默认不限制</b>：{@code monthly-limit-cny} 与 {@code scene-monthly-limits}
 * 都不配置时 {@link #isEnabled()} 为 false，预算拦截整体跳过。
 * 这是刻意的——预算熔断默认打开会让没配预算的使用者某天突然用不了 AI，
 * 且完全不知道发生了什么。要熔断必须显式配额度。
 *
 * <p><b>两级额度，语义不同</b>：
 * <ul>
 *   <li><b>场景额度</b>（{@code scene-monthly-limits}）：预算分配。某个场景花超了
 *       <b>只熔断该场景</b>——对话超限不该让课表解析一起挂，后者往往更紧急。</li>
 *   <li><b>全局额度</b>（{@code monthly-limit-cny}）：总闸。所有场景合计花超了才熔断全部。</li>
 * </ul>
 *
 * <p>额度按 <b>自然月</b> 结算，每月 1 号自动归零，不需要任何定时任务。
 */
@Component
@ConfigurationProperties(prefix = "app.llm.budget")
public class LlmBudgetProperties {

    /** 全局月度上限（元）。null 或 &lt;= 0 表示不限制。 */
    private Double monthlyLimitCny;

    /** 分场景月度上限（元）。key 取 {@link com.timetable.entity.LlmUsage} 的 SCENE_*。 */
    private Map<String, Double> sceneMonthlyLimits = new HashMap<>();

    /** 是否配了任何额度。没配就完全不拦截。 */
    public boolean isEnabled() {
        if (monthlyLimitCny != null && monthlyLimitCny > 0) {
            return true;
        }
        return sceneMonthlyLimits.values().stream().anyMatch(v -> v != null && v > 0);
    }

    /**
     * 取某个场景的月度上限；未单独配置返回 null（表示只看全局额度）。
     * key 大小写与空格不敏感，配置里写 {@code chat} 也能命中 {@code CHAT}。
     */
    public Double limitFor(String scene) {
        if (scene == null || scene.isBlank()) {
            return null;
        }
        Double limit = sceneMonthlyLimits.get(scene.trim().toUpperCase());
        return (limit == null || limit <= 0) ? null : limit;
    }

    /** 全局额度；未配置（null 或 &lt;=0）返回 null。 */
    public Double getMonthlyLimitCnyOrNull() {
        return (monthlyLimitCny == null || monthlyLimitCny <= 0) ? null : monthlyLimitCny;
    }

    public Double getMonthlyLimitCny() { return monthlyLimitCny; }
    public void setMonthlyLimitCny(Double monthlyLimitCny) { this.monthlyLimitCny = monthlyLimitCny; }
    public Map<String, Double> getSceneMonthlyLimits() { return sceneMonthlyLimits; }

    /**
     * key 统一转大写：yml 里写 {@code chat:} 更自然，而场景常量是 {@code CHAT}。
     * 不做归一化的话配置「看起来对了」但永远命中不了——这种静默失效最难查。
     */
    public void setSceneMonthlyLimits(Map<String, Double> sceneMonthlyLimits) {
        Map<String, Double> normalized = new HashMap<>();
        if (sceneMonthlyLimits != null) {
            for (Map.Entry<String, Double> entry : sceneMonthlyLimits.entrySet()) {
                if (entry.getKey() != null) {
                    normalized.put(entry.getKey().trim().toUpperCase(), entry.getValue());
                }
            }
        }
        this.sceneMonthlyLimits = normalized;
    }
}
