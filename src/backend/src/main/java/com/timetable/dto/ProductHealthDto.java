package com.timetable.dto;

/**
 * 产品健康度：计划采纳率 + 留存（成本治理 6.1 #1 的最后一块）。
 *
 * <h2>采纳率口径</h2>
 *
 * <ul>
 *   <li><b>分母</b> = 窗口内「真的调模型生成过」的计划数（{@code PLAN_GENERATED}）。
 *       缓存命中不算——用户没花 token，也不是一次新的生成。</li>
 *   <li><b>分子</b> = 其中「当天计划里安排的任务，至少有一个被推进/完成」的数量
 *       （{@code PLAN_ADOPTED}）。</li>
 *   <li><b>pendingCount</b> = 生成不久、当天还没过完的计划。既不算采用也不算未采用，
 *       单独返回，免得「生成 10 份、采纳 3 份」被读成 30%（其实有 4 份还没到期）。</li>
 * </ul>
 *
 * <p><b>为什么不用「用户点了赞」</b>：那种数据会自欺欺人，用户随手就点了。
 * 任务真被做完，是唯一不会说谎的证据。
 *
 * <p><b>已知低估</b>：重复生成会覆盖当日计划内容，覆盖前完成的任务不会被计入。
 * 方向是低估而非高估——对一个用来判断「这功能值不值得继续投入」的指标来说，低估更安全。
 *
 * <h2>留存口径</h2>
 *
 * <p>{@code retentionRate} = 最近 7 天内「至少活跃过 2 天」的用户占比。
 * 用「2 天」而不是严格的次日留存，是因为这是个单人/小圈子工具，
 * 学生不是每天都有课要排——隔天用一次完全正常，按次日算会把正常使用判成流失。
 *
 * <p>⚠️ <b>样本量提醒</b>：用户数很少时这个百分比没有统计意义（1 个用户 = 0% 或 100%）。
 * 所以 {@code activeUserCount} 一并返回，前端必须在样本过小时展示绝对数而不是百分比。
 */
public class ProductHealthDto {

    // ---------- 计划采纳率 ----------

    /** 窗口内真正生成过（调了模型）的计划份数。 */
    private long generatedCount;
    /** 其中被判定采用的份数。 */
    private long adoptedCount;
    /** 还没过完当天、无法下结论的份数。 */
    private long pendingCount;
    /** 采纳率 0~100（两位小数）；有效分母为 0 时为 null。 */
    private Double adoptionRate;

    // ---------- 留存 ----------

    /** 窗口内有任何活跃的用户数（样本量，看留存率时必须一起看）。 */
    private long activeUserCount;
    /** 其中活跃 ≥2 天的用户数。 */
    private long retainedUserCount;
    /** 留存率 0~100（两位小数）；用户数为 0 时为 null。 */
    private Double retentionRate;
    /** 统计窗口天数。 */
    private int windowDays;

    public long getGeneratedCount() { return generatedCount; }
    public void setGeneratedCount(long generatedCount) { this.generatedCount = generatedCount; }
    public long getAdoptedCount() { return adoptedCount; }
    public void setAdoptedCount(long adoptedCount) { this.adoptedCount = adoptedCount; }
    public long getPendingCount() { return pendingCount; }
    public void setPendingCount(long pendingCount) { this.pendingCount = pendingCount; }
    public Double getAdoptionRate() { return adoptionRate; }
    public void setAdoptionRate(Double adoptionRate) { this.adoptionRate = adoptionRate; }
    public long getActiveUserCount() { return activeUserCount; }
    public void setActiveUserCount(long activeUserCount) { this.activeUserCount = activeUserCount; }
    public long getRetainedUserCount() { return retainedUserCount; }
    public void setRetainedUserCount(long retainedUserCount) { this.retainedUserCount = retainedUserCount; }
    public Double getRetentionRate() { return retentionRate; }
    public void setRetentionRate(Double retentionRate) { this.retentionRate = retentionRate; }
    public int getWindowDays() { return windowDays; }
    public void setWindowDays(int windowDays) { this.windowDays = windowDays; }
}
