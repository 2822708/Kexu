package com.timetable.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * LLM 用量统计（成本治理 P0-1）。
 *
 * <p>金额是<b>估算</b>：按 {@code app.llm.pricing} 配置的单价 × 实际 token 计算，
 * 单价来自配置而非硬编码，价格过期时不会给出看起来精确的错误数字。
 */
public class UsageStatsDto {

    /** 统计窗口天数。 */
    private int days;
    /** 币种符号。 */
    private String currency = "CNY";
    private long callCount;
    private long errorCount;
    private long promptTokens;
    private long completionTokens;
    private long totalTokens;
    /** 估算总成本（元）。 */
    private double estimatedCost;
    /** 平均延迟毫秒，无数据时为 null。 */
    private Integer avgLatencyMs;

    /**
     * 前缀缓存命中率（成本治理 6.1 #4），0~1。
     *
     * <p>分母只统计「上游报了缓存字段」的调用。全部 provider 都不支持缓存时为
     * null 而不是 0——「没有可命中的机会」和「有机会但一次没中」是两回事，
     * 前者显示 0% 会让人误以为缓存配置写错了。
     */
    private Double cacheHitRate;
    /** 命中缓存的输入 token 合计。 */
    private long cacheHitTokens;
    /** 未命中缓存的输入 token 合计。 */
    private long cacheMissTokens;
    /**
     * 相比「全部按普通输入价」省下的钱（元）。单价未配缓存价时为 0。
     *
     * <p>展示这个数字而不是只给个百分比，是因为百分比看着漂亮但不等于省钱：
     * 命中率 90% 但输入只占成本的 10%，实际省下的可能是零头。
     */
    private double cacheSavedCny;

    private List<SceneBreakdown> scenes;
    private List<DailyPoint> daily;
    /** 月度预算与已用额度（成本治理 P0-2）。未配预算时为 null。 */
    private BudgetInfo budget;

    /**
     * 月度预算（成本治理 P0-2）。
     *
     * <p>必须和用量看板放在同一屏：否则用户被 429 拦下时完全不知道为什么，
     * 也不知道什么时候能恢复。
     */
    public static class BudgetInfo {
        /** 全局月度上限（元），null = 未配置。 */
        private Double monthlyLimitCny;
        /** 本月已用（元，全场景合计）。 */
        private double usedCny;
        /** 本月剩余（元）；未配全局额度时为 null。 */
        private Double remainingCny;
        /** 当前是否已被熔断（按调用时同样的判定）。 */
        private boolean blocked;
        /** 配了独立额度的场景；没配的场景不返回，避免前端渲染一堆「不限」。 */
        private List<SceneBudget> scenes;

        public Double getMonthlyLimitCny() { return monthlyLimitCny; }
        public void setMonthlyLimitCny(Double monthlyLimitCny) { this.monthlyLimitCny = monthlyLimitCny; }
        public double getUsedCny() { return usedCny; }
        public void setUsedCny(double usedCny) { this.usedCny = usedCny; }
        public Double getRemainingCny() { return remainingCny; }
        public void setRemainingCny(Double remainingCny) { this.remainingCny = remainingCny; }
        public boolean isBlocked() { return blocked; }
        public void setBlocked(boolean blocked) { this.blocked = blocked; }
        public List<SceneBudget> getScenes() { return scenes; }
        public void setScenes(List<SceneBudget> scenes) { this.scenes = scenes; }
    }

    public static class SceneBudget {
        private String scene;
        private String sceneLabel;
        private Double limitCny;
        private double usedCny;
        private boolean exceeded;

        public String getScene() { return scene; }
        public void setScene(String scene) { this.scene = scene; }
        public String getSceneLabel() { return sceneLabel; }
        public void setSceneLabel(String sceneLabel) { this.sceneLabel = sceneLabel; }
        public Double getLimitCny() { return limitCny; }
        public void setLimitCny(Double limitCny) { this.limitCny = limitCny; }
        public double getUsedCny() { return usedCny; }
        public void setUsedCny(double usedCny) { this.usedCny = usedCny; }
        public boolean isExceeded() { return exceeded; }
        public void setExceeded(boolean exceeded) { this.exceeded = exceeded; }
    }

    public static class SceneBreakdown {
        private String scene;
        private String sceneLabel;
        private long callCount;
        private long totalTokens;
        private double estimatedCost;

        public String getScene() { return scene; }
        public void setScene(String scene) { this.scene = scene; }
        public String getSceneLabel() { return sceneLabel; }
        public void setSceneLabel(String sceneLabel) { this.sceneLabel = sceneLabel; }
        public long getCallCount() { return callCount; }
        public void setCallCount(long callCount) { this.callCount = callCount; }
        public long getTotalTokens() { return totalTokens; }
        public void setTotalTokens(long totalTokens) { this.totalTokens = totalTokens; }
        public double getEstimatedCost() { return estimatedCost; }
        public void setEstimatedCost(double estimatedCost) { this.estimatedCost = estimatedCost; }
    }

    public static class DailyPoint {
        private LocalDate date;
        private long callCount;
        private long totalTokens;

        public LocalDate getDate() { return date; }
        public void setDate(LocalDate date) { this.date = date; }
        public long getCallCount() { return callCount; }
        public void setCallCount(long callCount) { this.callCount = callCount; }
        public long getTotalTokens() { return totalTokens; }
        public void setTotalTokens(long totalTokens) { this.totalTokens = totalTokens; }
    }

    public int getDays() { return days; }
    public void setDays(int days) { this.days = days; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public long getCallCount() { return callCount; }
    public void setCallCount(long callCount) { this.callCount = callCount; }
    public long getErrorCount() { return errorCount; }
    public void setErrorCount(long errorCount) { this.errorCount = errorCount; }
    public long getPromptTokens() { return promptTokens; }
    public void setPromptTokens(long promptTokens) { this.promptTokens = promptTokens; }
    public long getCompletionTokens() { return completionTokens; }
    public void setCompletionTokens(long completionTokens) { this.completionTokens = completionTokens; }
    public long getTotalTokens() { return totalTokens; }
    public void setTotalTokens(long totalTokens) { this.totalTokens = totalTokens; }
    public double getEstimatedCost() { return estimatedCost; }
    public void setEstimatedCost(double estimatedCost) { this.estimatedCost = estimatedCost; }
    public Integer getAvgLatencyMs() { return avgLatencyMs; }
    public void setAvgLatencyMs(Integer avgLatencyMs) { this.avgLatencyMs = avgLatencyMs; }
    public Double getCacheHitRate() { return cacheHitRate; }
    public void setCacheHitRate(Double cacheHitRate) { this.cacheHitRate = cacheHitRate; }
    public long getCacheHitTokens() { return cacheHitTokens; }
    public void setCacheHitTokens(long cacheHitTokens) { this.cacheHitTokens = cacheHitTokens; }
    public long getCacheMissTokens() { return cacheMissTokens; }
    public void setCacheMissTokens(long cacheMissTokens) { this.cacheMissTokens = cacheMissTokens; }
    public double getCacheSavedCny() { return cacheSavedCny; }
    public void setCacheSavedCny(double cacheSavedCny) { this.cacheSavedCny = cacheSavedCny; }
    public List<SceneBreakdown> getScenes() { return scenes; }
    public void setScenes(List<SceneBreakdown> scenes) { this.scenes = scenes; }
    public List<DailyPoint> getDaily() { return daily; }
    public void setDaily(List<DailyPoint> daily) { this.daily = daily; }
    public BudgetInfo getBudget() { return budget; }
    public void setBudget(BudgetInfo budget) { this.budget = budget; }
}