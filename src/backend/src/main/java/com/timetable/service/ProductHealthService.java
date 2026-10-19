package com.timetable.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.dto.ProductHealthDto;
import com.timetable.entity.AiEvent;
import com.timetable.mapper.AiEventMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 产品健康度统计：计划采纳率 + 留存（成本治理 6.1 #1）。
 *
 * <p>与 {@code UsageStatsServiceImpl} 分开的原因：那个类算的是「花了多少钱」，
 * 这个类算的是「东西有没有用」。混在一起以后，任何一方加指标都会让另一个类的
 * 测试跟着抖，而这两件事的失败后果完全不同（钱算错要命，采纳率算错只是判断偏差）。
 */
@Service
public class ProductHealthService {

    private static final Logger log = LoggerFactory.getLogger(ProductHealthService.class);

    /** 留存统计窗口：最近 7 天。 */
    static final int RETENTION_WINDOW_DAYS = 7;
    /** 采纳率统计窗口：最近 14 天（比留存宽，因为计划不是每天都生成）。 */
    static final int ADOPTION_WINDOW_DAYS = 14;

    private final AiEventMapper eventMapper;
    private final DailyPlanAdoptionService adoptionService;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public ProductHealthService(AiEventMapper eventMapper, DailyPlanAdoptionService adoptionService,
                                JdbcTemplate jdbc, Clock clock) {
        this.eventMapper = eventMapper;
        this.adoptionService = adoptionService;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * 计算当前用户的健康度。
     *
     * <p>先做一次采纳补算（{@link DailyPlanAdoptionService#settleRecent}），
     * 这样用户打开统计页看到的是「已经过完的每一天都算过了」的结果，
     * 而不是要等后台任务跑到才更新。
     */
    public ProductHealthDto forUser(String apiKey) {
        adoptionService.settleRecent(apiKey);

        ProductHealthDto dto = new ProductHealthDto();
        fillAdoption(dto, apiKey);
        fillRetention(dto);
        return dto;
    }

    private void fillAdoption(ProductHealthDto dto, String apiKey) {
        LocalDateTime since = LocalDate.now(clock).minusDays(ADOPTION_WINDOW_DAYS).atStartOfDay();

        long generated = countEvents(apiKey, AiEvent.TYPE_PLAN_GENERATED, since);
        long adopted = countEvents(apiKey, AiEvent.TYPE_PLAN_ADOPTED, since);

        // 「还没过完当天」的计划：生成时间在最近一天内、且当天就是今天或明天。
        // 这些既不算采用也不算未采用，单独拿出来，否则比率会被未定的样本拉低。
        long pending = countPendingPlans(apiKey, since);

        dto.setGeneratedCount(generated);
        dto.setAdoptedCount(adopted);
        dto.setPendingCount(pending);

        long settled = generated - pending;
        dto.setAdoptionRate(settled <= 0 ? null : round2(adopted * 100d / settled));
    }

    private long countEvents(String apiKey, String eventType, LocalDateTime since) {
        Long count = eventMapper.selectCount(new LambdaQueryWrapper<AiEvent>()
                .eq(AiEvent::getApiKey, apiKey)
                .eq(AiEvent::getEventType, eventType)
                .ge(AiEvent::getCreatedAt, since));
        return count == null ? 0 : count;
    }

    /**
     * 未定计划数：当天还没过完的那些。
     *
     * <p>直接查 {@code daily_plan} 而不是事件：事件里没有 plan_date，
     * 而「有没有过完当天」只取决于 plan_date。
     */
    private long countPendingPlans(String apiKey, LocalDateTime since) {
        try {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM daily_plan WHERE api_key = ? AND created_at >= ?"
                            + " AND plan_date >= ?",
                    Integer.class, apiKey, since, LocalDate.now(clock));
            return count == null ? 0 : count;
        } catch (Exception e) {
            log.warn("统计未定计划失败，按 0 处理：{}", e.getClass().getSimpleName());
            return 0;
        }
    }

    /**
     * 留存：最近 7 天里，活跃 ≥2 天的用户占比。
     *
     * <p>这是<b>跨用户</b>的聚合（唯一一处不带 api_key 过滤的查询），
     * 因为它天生就是全局指标。只取计数，不返回任何可识别到个人的信息。
     */
    private void fillRetention(ProductHealthDto dto) {
        dto.setWindowDays(RETENTION_WINDOW_DAYS);
        LocalDateTime since = LocalDate.now(clock).minusDays(RETENTION_WINDOW_DAYS).atStartOfDay();
        try {
            // 活跃按「某天有过任意行为事件」算。同一天多条只算一天。
            // 用 DATE() 而不是 CAST(x AS DATE)：两者在 H2(MySQL 模式) 与 MySQL 下结果一致，
            // 但 DATE() 在两边都是原生函数，跨库迁移时更不容易踩到方言坑。
            List<java.util.Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT api_key, COUNT(DISTINCT DATE(created_at)) AS active_days"
                            + " FROM ai_event WHERE created_at >= ? GROUP BY api_key", since);
            long active = rows.size();
            long retained = rows.stream()
                    .filter(r -> {
                        Object v = r.get("active_days");
                        return v instanceof Number && ((Number) v).longValue() >= 2;
                    })
                    .count();
            dto.setActiveUserCount(active);
            dto.setRetainedUserCount(retained);
            dto.setRetentionRate(active == 0 ? null : round2(retained * 100d / active));
        } catch (Exception e) {
            log.warn("统计留存失败，按空处理：{}", e.getClass().getSimpleName());
        }
    }

    private static double round2(double value) {
        return Math.round(value * 100d) / 100d;
    }
}
