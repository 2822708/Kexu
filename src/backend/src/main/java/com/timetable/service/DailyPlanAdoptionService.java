package com.timetable.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.entity.AiEvent;
import com.timetable.entity.DailyPlan;
import com.timetable.entity.Task;
import com.timetable.mapper.DailyPlanMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * 每日计划采纳判定（成本治理 6.1 #1 的最后一块）。
 *
 * <h2>「采用」怎么算</h2>
 *
 * <p>计划被采纳的唯一有说服力证据是：<b>计划里安排的任务，当天真的被推进了</b>。
 * 所以不去让用户点「这计划不错」（那种按钮的数据没价值，用户会随手点），
 * 而是拿计划内容与任务的实际状态变化对账：
 *
 * <ol>
 *   <li>计划里 {@code type=TASK} 的条目带 {@code refId}，指向具体任务；</li>
 *   <li>看这些任务在「生成时刻 → 当日结束」之间有没有变成 {@code DONE} / {@code IN_PROGRESS}；</li>
 *   <li>有一个就算采用。</li>
 * </ol>
 *
 * <p>只要求一个而不是全部：模型给 8 条建议、用户照着做了 1 条，已经证明计划有用。
 * 要求「全做完」会让采纳率永远接近 0，指标就废了。
 *
 * <h2>为什么是「读时对账」</h2>
 *
 * <p>计划的成效要等一天过去才看得出来。生成那一刻只知道「发出去了」，
 * 所以做成读时回溯 + 一次性落库：统计接口被调用时补算还没结论的历史计划，
 * 落一条 {@link AiEvent#TYPE_PLAN_ADOPTED} 之后就不再重复。
 *
 * <h2>已知误差（写在这里免得后人误读指标）</h2>
 *
 * <p>{@code daily_plan} 上 {@code uk(api_key, plan_date)} 保证一天只有一行，重新生成会覆盖内容。
 * 若用户在覆盖前就已经完成了任务，这一单会被判成「未采用」。方向是<b>低估而非高估</b>——
 * 对一个用来判断「这功能值不值得投」的指标，低估更安全。
 */
@Service
public class DailyPlanAdoptionService {

    private static final Logger log = LoggerFactory.getLogger(DailyPlanAdoptionService.class);

    /** 判定窗口：只回溯最近这么多天的计划，够看趋势，又不会每次统计都扫全表。 */
    private static final int LOOKBACK_DAYS = 7;
    /** 单次最多处理多少份，防止历史数据把统计接口拖慢。 */
    private static final int MAX_PLANS_PER_CALL = 200;

    private final DailyPlanMapper planMapper;
    private final AiEventRecorder eventRecorder;
    private final ObjectMapper objectMapper;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public DailyPlanAdoptionService(DailyPlanMapper planMapper, AiEventRecorder eventRecorder,
                                    ObjectMapper objectMapper, JdbcTemplate jdbc, Clock clock) {
        this.planMapper = planMapper;
        this.eventRecorder = eventRecorder;
        this.objectMapper = objectMapper;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * 补算最近若干天里已过完、但还没有结论的计划，返回本轮新判定为「已采用」的条数。
     *
     * <p>吞掉所有异常：这是统计功能，不能让一份脏 JSON 把用量接口带崩。
     */
    public int settleRecent(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return 0;
        }
        try {
            LocalDate since = LocalDate.now(clock).minusDays(LOOKBACK_DAYS);
            LambdaQueryWrapper<DailyPlan> wrapper = new LambdaQueryWrapper<>();
            wrapper.eq(DailyPlan::getApiKey, apiKey)
                    .ge(DailyPlan::getPlanDate, since)
                    .orderByDesc(DailyPlan::getPlanDate)
                    .last("LIMIT " + MAX_PLANS_PER_CALL);

            LocalDateTime now = LocalDateTime.now(clock);
            int adopted = 0;
            for (DailyPlan plan : planMapper.selectList(wrapper)) {
                if (plan.getCreatedAt() == null || plan.getPlanDate() == null) {
                    continue;
                }
                // 计划只对「那一天」负责，过了次日零点才谈得上有没有照着做。
                LocalDateTime windowEnd = plan.getPlanDate().plusDays(1).atStartOfDay();
                if (now.isBefore(windowEnd)) {
                    continue;
                }
                if (alreadySettled(apiKey, plan.getId())) {
                    continue;
                }
                if (isAdopted(apiKey, plan, windowEnd)) {
                    eventRecorder.record(apiKey, AiEvent.TYPE_PLAN_ADOPTED, null, null, plan.getId());
                    adopted++;
                }
            }
            return adopted;
        } catch (Exception e) {
            log.warn("计划采纳判定失败（已忽略，不影响统计主流程）：{}", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** 同一份计划只判一次，避免统计页每刷新一次就重复落事件把分子刷大。 */
    private boolean alreadySettled(String apiKey, Long planId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM ai_event WHERE api_key = ? AND event_type = ? AND ref_id = ?",
                Integer.class, apiKey, AiEvent.TYPE_PLAN_ADOPTED, planId);
        return count != null && count > 0;
    }

    private boolean isAdopted(String apiKey, DailyPlan plan, LocalDateTime windowEnd) {
        List<Long> taskIds = taskRefIds(plan.getContent());
        if (taskIds.isEmpty()) {
            // 计划里没有任何任务块（比如那天没待办），谈不上采纳，也不该算作「发了没用」
            return false;
        }
        try {
            List<Object> args = new ArrayList<>();
            args.add(apiKey);
            args.addAll(taskIds);
            args.add(Task.STATUS_DONE);
            args.add(Task.STATUS_IN_PROGRESS);
            args.add(plan.getCreatedAt());
            args.add(windowEnd);
            String placeholders = String.join(",", Collections.nCopies(taskIds.size(), "?"));
            String sql = "SELECT COUNT(*) FROM task WHERE api_key = ? AND id IN (" + placeholders + ")"
                    + " AND status IN (?, ?) AND updated_at >= ? AND updated_at < ?";
            Integer hit = jdbc.queryForObject(sql, Integer.class, args.toArray());
            return hit != null && hit > 0;
        } catch (Exception e) {
            log.warn("计划任务对账失败（计划 id={}）：{}", plan.getId(), e.getClass().getSimpleName());
            return false;
        }
    }

    /**
     * 从 content JSON 里抽 {@code type=TASK} 条目的 refId。
     *
     * <p>不复用 {@code DailyPlanServiceImpl} 的解析：那边带一整套为「模型输出」准备的校验，
     * 这里只需要 id。读不出来就当作没有可对账的任务，判未采用。
     */
    private List<Long> taskRefIds(String content) {
        List<Long> ids = new ArrayList<>();
        if (content == null || content.isBlank()) {
            return ids;
        }
        try {
            JsonNode items = objectMapper.readTree(content).path("items");
            if (!items.isArray()) {
                return ids;
            }
            for (JsonNode item : items) {
                if (!"TASK".equalsIgnoreCase(item.path("type").asText(""))) {
                    continue;
                }
                JsonNode ref = item.has("refId") ? item.get("refId") : item.get("ref_id");
                if (ref != null && ref.canConvertToLong()) {
                    ids.add(ref.asLong());
                }
            }
        } catch (Exception e) {
            log.debug("计划内容不是合法 JSON，跳过采纳判定");
        }
        return ids;
    }
}
