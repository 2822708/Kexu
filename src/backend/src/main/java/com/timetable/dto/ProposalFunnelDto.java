package com.timetable.dto;

/**
 * 提案漏斗（成本治理 P0-1）。
 *
 * <p><b>口径说明</b>：{@code confirmRate} 是「已落库口径」——
 * EXECUTED / REJECTED / STALE 三种终态都有确定结果。展示态的 STALE 复核
 * （用户看到卡片时才发现数据变了）<b>不落库</b>，那是既有设计，所以这个比率
 * 会略高于真实有效提案占比；{@code decidedCount} 一并返回，便于判断样本量够不够。
 */
public class ProposalFunnelDto {

    /** PENDING 中等待用户决定的数量。 */
    private long pendingCount;
    /** 已确认执行。 */
    private long executedCount;
    /** 用户明确拒绝。 */
    private long rejectedCount;
    /** 因数据变化被判定失效。 */
    private long staleCount;
    /** 已作出决定（executed + rejected + stale）。 */
    private long decidedCount;
    /** 确认率，0~100（百分数两位小数）。分母为 0 时为 null。 */
    private Double confirmRate;
    /** 平均「生成 → 确认」耗时秒数；无已决记录时为 null。 */
    private Double avgDecideSeconds;

    public long getPendingCount() { return pendingCount; }
    public void setPendingCount(long pendingCount) { this.pendingCount = pendingCount; }
    public long getExecutedCount() { return executedCount; }
    public void setExecutedCount(long executedCount) { this.executedCount = executedCount; }
    public long getRejectedCount() { return rejectedCount; }
    public void setRejectedCount(long rejectedCount) { this.rejectedCount = rejectedCount; }
    public long getStaleCount() { return staleCount; }
    public void setStaleCount(long staleCount) { this.staleCount = staleCount; }
    public long getDecidedCount() { return decidedCount; }
    public void setDecidedCount(long decidedCount) { this.decidedCount = decidedCount; }
    public Double getConfirmRate() { return confirmRate; }
    public void setConfirmRate(Double confirmRate) { this.confirmRate = confirmRate; }
    public Double getAvgDecideSeconds() { return avgDecideSeconds; }
    public void setAvgDecideSeconds(Double avgDecideSeconds) { this.avgDecideSeconds = avgDecideSeconds; }
}