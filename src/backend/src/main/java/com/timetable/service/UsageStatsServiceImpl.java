package com.timetable.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.dto.ProposalFunnelDto;
import com.timetable.dto.UsageStatsDto;
import com.timetable.entity.AiAction;
import com.timetable.entity.LlmUsage;
import com.timetable.mapper.AiActionMapper;
import com.timetable.mapper.LlmUsageMapper;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 用量与提案漏斗统计（成本治理 P0-1）。
 *
 * <p><b>所有查询强制带 api_key 条件</b>——与 Dashboard 同一套单用户模型，
 * 漏掉这个条件就会把别人的 token 成本和提案数据暴露出去。
 */
@Service
public class UsageStatsServiceImpl implements UsageStatsService {

    /** 允许的统计窗口上限，防止误传 days=999999 拖垮数据库。 */
    private static final int MAX_DAYS = 365;
    private static final int DEFAULT_DAYS = 30;

    private static final Map<String, String> SCENE_LABELS = new LinkedHashMap<>();

    static {
        SCENE_LABELS.put(LlmUsage.SCENE_CHAT, "对话");
        SCENE_LABELS.put(LlmUsage.SCENE_EXTRACT, "任务抽取");
        SCENE_LABELS.put(LlmUsage.SCENE_INBOX, "通知提炼");
        SCENE_LABELS.put(LlmUsage.SCENE_PLAN, "每日计划");
        SCENE_LABELS.put(LlmUsage.SCENE_REFINE, "记忆提炼");
        SCENE_LABELS.put(LlmUsage.SCENE_PARSE_HTML, "课表解析");
        SCENE_LABELS.put(LlmUsage.SCENE_OCR, "图片识别");
        SCENE_LABELS.put(LlmUsage.SCENE_UNKNOWN, "未分类");
    }

    private final LlmUsageMapper usageMapper;
    private final AiActionMapper actionMapper;
    private final LlmPricingProperties pricing;
    private final LlmBudgetService budgetService;
    private final LlmBudgetProperties budgetProperties;

    public UsageStatsServiceImpl(LlmUsageMapper usageMapper, AiActionMapper actionMapper,
                                 LlmPricingProperties pricing, LlmBudgetService budgetService,
                                 LlmBudgetProperties budgetProperties) {
        this.usageMapper = usageMapper;
        this.actionMapper = actionMapper;
        this.pricing = pricing;
        this.budgetService = budgetService;
        this.budgetProperties = budgetProperties;
    }

    @Override
    public UsageStatsDto usage(Integer daysParam, String apiKey) {
        int days = normalizeDays(daysParam);
        UsageStatsDto dto = new UsageStatsDto();
        dto.setDays(days);
        dto.setCurrency(pricing.getCurrency());

        LocalDateTime since = LocalDateTime.now().minusDays(days);
        List<LlmUsage> rows = usageMapper.selectList(Wrappers.<LlmUsage>lambdaQuery()
                .eq(LlmUsage::getApiKey, apiKey)
                .ge(LlmUsage::getCreatedAt, since)
                .orderByAsc(LlmUsage::getCreatedAt));

        long promptTokens = 0;
        long completionTokens = 0;
        long errorCount = 0;
        long latencySum = 0;
        long latencyCount = 0;
        double cost = 0;
        Map<String, UsageStatsDto.SceneBreakdown> perScene = new LinkedHashMap<>();
        Map<LocalDate, UsageStatsDto.DailyPoint> perDay = new LinkedHashMap<>();

        for (LlmUsage row : rows) {
            int in = row.getPromptTokens() == null ? 0 : row.getPromptTokens();
            int out = row.getCompletionTokens() == null ? 0 : row.getCompletionTokens();
            promptTokens += in;
            completionTokens += out;
            if (LlmUsage.STATUS_ERROR.equals(row.getStatus())) {
                errorCount++;
            }
            if (row.getLatencyMs() != null) {
                latencySum += row.getLatencyMs();
                latencyCount++;
            }

            // 单价按该条记录实际用的模型取，缺 usage 时按 0 计不报错。
            LlmPricingProperties.PerMillion rate = pricing.forModel(row.getModel());
            cost += (in * rate.getInput() + out * rate.getOutput()) / 1_000_000d;

            String scene = row.getScene() == null ? LlmUsage.SCENE_UNKNOWN : row.getScene();
            UsageStatsDto.SceneBreakdown breakdown = perScene.computeIfAbsent(scene, s -> {
                UsageStatsDto.SceneBreakdown b = new UsageStatsDto.SceneBreakdown();
                b.setScene(s);
                b.setSceneLabel(SCENE_LABELS.getOrDefault(s, s));
                return b;
            });
            breakdown.setCallCount(breakdown.getCallCount() + 1);
            breakdown.setTotalTokens(breakdown.getTotalTokens() + in + out);
            breakdown.setEstimatedCost(roundMoney(breakdown.getEstimatedCost()
                    + (in * rate.getInput() + out * rate.getOutput()) / 1_000_000d));

            LocalDate date = row.getCreatedAt() == null ? since.toLocalDate() : row.getCreatedAt().toLocalDate();
            UsageStatsDto.DailyPoint point = perDay.computeIfAbsent(date, d -> {
                UsageStatsDto.DailyPoint p = new UsageStatsDto.DailyPoint();
                p.setDate(d);
                return p;
            });
            point.setCallCount(point.getCallCount() + 1);
            point.setTotalTokens(point.getTotalTokens() + in + out);
        }

        dto.setCallCount(rows.size());
        dto.setErrorCount(errorCount);
        dto.setPromptTokens(promptTokens);
        dto.setCompletionTokens(completionTokens);
        dto.setTotalTokens(promptTokens + completionTokens);
        dto.setEstimatedCost(roundMoney(cost));
        dto.setAvgLatencyMs(latencyCount == 0 ? null : (int) (latencySum / latencyCount));
        dto.setScenes(new ArrayList<>(perScene.values()));
        // 按日期升序，便于前端直接画趋势（缺日期不补零，避免看起来像有调用）。
        List<UsageStatsDto.DailyPoint> daily = new ArrayList<>(perDay.values());
        daily.sort((a, b) -> a.getDate().compareTo(b.getDate()));
        dto.setDaily(daily);
        dto.setBudget(buildBudget(apiKey));
        return dto;
    }

    /**
     * 月度预算卡片（成本治理 P0-2）。
     *
     * <p><b>未配预算时返回 null</b>，前端据此整块不渲染——显示「不限 / 不限 / 不限」
     * 这种空卡片比不显示更糟，会让人以为额度没生效。
     *
     * <p>这里的「已用」与 {@link LlmBudgetService} 判定时用的是同一个口径
     * （同自然月、同单价表、失败调用同样计入），两边不会打架。
     */
    private UsageStatsDto.BudgetInfo buildBudget(String apiKey) {
        if (!budgetService.isEnabled()) {
            return null;
        }
        Double global = budgetProperties.getMonthlyLimitCnyOrNull();
        double usedAll = budgetService.spentThisMonth(apiKey, null);

        UsageStatsDto.BudgetInfo info = new UsageStatsDto.BudgetInfo();
        info.setMonthlyLimitCny(global);
        info.setUsedCny(roundMoney(usedAll));
        info.setRemainingCny(global == null ? null : roundMoney(Math.max(0, global - usedAll)));
        info.setBlocked(global != null && usedAll >= global);

        List<UsageStatsDto.SceneBudget> scenes = new ArrayList<>();
        for (Map.Entry<String, Double> entry : budgetProperties.getSceneMonthlyLimits().entrySet()) {
            Double limit = entry.getValue();
            if (limit == null || limit <= 0) {
                continue;
            }
            double used = budgetService.spentThisMonth(apiKey, entry.getKey());
            UsageStatsDto.SceneBudget scene = new UsageStatsDto.SceneBudget();
            scene.setScene(entry.getKey());
            scene.setSceneLabel(SCENE_LABELS.getOrDefault(entry.getKey(), entry.getKey()));
            scene.setLimitCny(limit);
            scene.setUsedCny(roundMoney(used));
            scene.setExceeded(used >= limit);
            scenes.add(scene);
        }
        info.setScenes(scenes);
        return info;
    }

    @Override
    public ProposalFunnelDto proposals(String apiKey) {
        List<AiAction> actions = actionMapper.selectList(Wrappers.<AiAction>lambdaQuery()
                .eq(AiAction::getApiKey, apiKey));

        long pending = 0;
        long executed = 0;
        long rejected = 0;
        long stale = 0;
        long decideMillisSum = 0;
        long decideCount = 0;

        for (AiAction action : actions) {
            String status = action.getActionStatus();
            if ("PENDING".equals(status)) {
                pending++;
                continue;
            }
            if ("EXECUTED".equals(status)) {
                executed++;
            } else if ("REJECTED".equals(status)) {
                rejected++;
            } else if ("STALE".equals(status)) {
                stale++;
            } else {
                // EXECUTING 是处理中间态，不算「已决定」
                continue;
            }
            if (action.getCreatedAt() != null && action.getDecidedAt() != null) {
                long millis = Duration.between(action.getCreatedAt(), action.getDecidedAt()).toMillis();
                if (millis >= 0) {
                    decideMillisSum += millis;
                    decideCount++;
                }
            }
        }

        ProposalFunnelDto dto = new ProposalFunnelDto();
        dto.setPendingCount(pending);
        dto.setExecutedCount(executed);
        dto.setRejectedCount(rejected);
        dto.setStaleCount(stale);
        long decided = executed + rejected + stale;
        dto.setDecidedCount(decided);
        dto.setConfirmRate(decided == 0 ? null
                : Math.round(executed * 10000d / decided) / 100d);
        // 毫秒 → 秒，保留 1 位小数（先在毫秒域做整数平均，再转秒并四舍五入到 0.1）
        dto.setAvgDecideSeconds(decideCount == 0 ? null
                : Math.round(decideMillisSum / decideCount) / 1000d);
        return dto;
    }

    /**
     * 金额取整到 4 位小数。
     *
     * <p>不round 的话前端会拿到 0.026600000000000002 这种浮点尾巴——金额字段
     * 出现这种值既难看又容易被误当成数据错误。4 位小数对「元/百万 token」这个
     * 量级足够精细（单次调用成本通常在 0.001元 以下，精度损失可忽略）。
     */
    private static double roundMoney(double value) {
        return Math.round(value * 10000d) / 10000d;
    }

    private static int normalizeDays(Integer daysParam) {
        if (daysParam == null) {
            return DEFAULT_DAYS;
        }
        if (daysParam < 1) {
            return 1;
        }
        return Math.min(daysParam, MAX_DAYS);
    }
}