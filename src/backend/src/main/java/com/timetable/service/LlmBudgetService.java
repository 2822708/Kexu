package com.timetable.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.entity.LlmUsage;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.LlmUsageMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * LLM 月度预算拦截（成本治理 P0-2）。
 *
 * <p>拦截点在所有 {@link LlmClient} 调用<b>之前</b>（由 {@link LlmClientRegistry#active()}
 * 返回的装饰器调用），因此：
 * <ul>
 *   <li>换 provider 不需要重做——新 provider 同样走 registry；</li>
 *   <li>超限的调用<b>一次 token 都不会花</b>，不是事后记账。</li>
 * </ul>
 *
 * <p><b>按场景分别判定</b>：{@code CHAT} 花超了只断 {@code CHAT}，{@code PARSE_HTML}
 * （课表解析）照常可用。把额度做成一个总闸会让「聊天聊嗨了」连带弄挂导入课表——
 * 后者往往是更紧急、更不可替代的操作。
 *
 * <p><b>统计口径与用量看板完全一致</b>：同一个自然月、同一套单价表
 * （{@link LlmPricingProperties}）、失败调用同样计入（token 已经花掉了）。
 * 两边口径不一致会出现「看板说没超，但请求被拦」这种无法解释的现象。
 */
@Service
public class LlmBudgetService {

    private static final Logger log = LoggerFactory.getLogger(LlmBudgetService.class);

    private final LlmUsageMapper usageMapper;
    private final LlmPricingProperties pricing;
    private final LlmBudgetProperties budget;

    public LlmBudgetService(LlmUsageMapper usageMapper, LlmPricingProperties pricing,
                            LlmBudgetProperties budget) {
        this.usageMapper = usageMapper;
        this.pricing = pricing;
        this.budget = budget;
    }

    /** 是否配了任何额度。没配就完全不拦截（默认不限制，避免误伤）。 */
    public boolean isEnabled() {
        return budget.isEnabled();
    }

    /**
     * 拦截检查：超限抛 429。
     *
     * @param apiKey 调用者身份；为 null 或空时跳过（与 {@link LlmUsageRecorder} 一致——
     *               没有身份就记不到用量，统计不到花费，判定必然不超限）
     * @param scene  场景标识，取 {@link LlmUsage} 的 SCENE_* 常量
     */
    public void check(String apiKey, String scene) {
        if (!budget.isEnabled()) {
            return;
        }
        if (apiKey == null || apiKey.isBlank()) {
            // 预算已启用却拿不到身份 = 拦截失效。静默放行会让额度形同虚设，必须留声。
            log.warn("预算拦截跳过：调用方身份为空（scene={}），本次调用不受额度约束", scene);
            return;
        }
        String normalized = (scene == null || scene.isBlank()) ? LlmUsage.SCENE_UNKNOWN : scene;

        // 先判场景额度：它更具体，报错信息也更好懂
        Double sceneLimit = budget.limitFor(normalized);
        if (sceneLimit != null) {
            double used = spentSince(apiKey, monthStart(), normalized);
            if (used >= sceneLimit) {
                log.info("LLM 预算拦截：scene={} 本月已用 {} 元，达到上限 {} 元",
                        normalized, round(used), sceneLimit);
                throw new BusinessException(429,
                        "本月「" + sceneLabel(normalized) + "」的 AI 预算已用完（上限 "
                                + sceneLimit + " 元）。其它功能不受影响，下月 1 号自动恢复。");
            }
        }

        Double globalLimit = budget.getMonthlyLimitCnyOrNull();
        if (globalLimit != null) {
            double used = spentSince(apiKey, monthStart(), null);
            if (used >= globalLimit) {
                log.info("LLM 预算拦截：全局本月已用 {} 元，达到上限 {} 元", round(used), globalLimit);
                throw new BusinessException(429,
                        "本月 AI 预算已用完（上限 " + globalLimit
                                + " 元），下月 1 号自动恢复。可在设置页查看用量明细。");
            }
        }
    }

    /**
     * 当月花费（元）。{@code scene} 为 null 时统计全部场景。
     *
     * <p>失败调用也计入——和用量看板同一口径。
     */
    public double spentThisMonth(String apiKey, String scene) {
        return spentSince(apiKey, monthStart(), scene);
    }

    private double spentSince(String apiKey, LocalDateTime since, String scene) {
        var query = Wrappers.<LlmUsage>lambdaQuery()
                .eq(LlmUsage::getApiKey, apiKey)
                .ge(LlmUsage::getCreatedAt, since);
        if (scene != null) {
            query.eq(LlmUsage::getScene, scene);
        }
        List<LlmUsage> rows;
        try {
            rows = usageMapper.selectList(query);
        } catch (Exception e) {
            // 查不到花费时放行：宁可少拦一次，也不能因为统计表异常让所有 AI 功能挂掉
            log.warn("查询 LLM 用量失败，本次跳过预算拦截：{}", e.getClass().getSimpleName());
            return 0;
        }
        double cost = 0;
        for (LlmUsage row : rows) {
            int in = row.getPromptTokens() == null ? 0 : row.getPromptTokens();
            int out = row.getCompletionTokens() == null ? 0 : row.getCompletionTokens();
            LlmPricingProperties.PerMillion rate = pricing.forModel(row.getModel());
            cost += (in * rate.getInput() + out * rate.getOutput()) / 1_000_000d;
        }
        return cost;
    }

    /** 自然月起点：每月 1 号 00:00，不需要定时任务重置。 */
    static LocalDateTime monthStart() {
        return LocalDate.now().withDayOfMonth(1).atStartOfDay();
    }

    static double round(double value) {
        return Math.round(value * 10000d) / 10000d;
    }

    private static String sceneLabel(String scene) {
        return switch (scene) {
            case LlmUsage.SCENE_CHAT -> "对话";
            case LlmUsage.SCENE_EXTRACT -> "任务抽取";
            case LlmUsage.SCENE_INBOX -> "通知提炼";
            case LlmUsage.SCENE_PLAN -> "每日计划";
            case LlmUsage.SCENE_REFINE -> "记忆提炼";
            case LlmUsage.SCENE_PARSE_HTML -> "课表解析";
            case LlmUsage.SCENE_OCR -> "图片识别";
            default -> scene;
        };
    }
}
