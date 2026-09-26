package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.dto.RecurringTodoRequest;
import com.timetable.entity.RecurringTodo;
import com.timetable.entity.Todo;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.RecurringTodoMapper;
import com.timetable.mapper.TodoMapper;
import com.timetable.service.RecurringTodoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Service
public class RecurringTodoServiceImpl implements RecurringTodoService {

    private static final Logger log = LoggerFactory.getLogger(RecurringTodoServiceImpl.class);

    /** 停机回补上限：单条规则一次最多补生成的期数，避免长期停机后刷出大量待办 */
    private static final int MAX_CATCH_UP = 5;

    private final RecurringTodoMapper recurringMapper;
    private final TodoMapper todoMapper;
    private final RecurringScriptEvaluator scriptEvaluator;

    public RecurringTodoServiceImpl(RecurringTodoMapper recurringMapper, TodoMapper todoMapper,
                                    RecurringScriptEvaluator scriptEvaluator) {
        this.recurringMapper = recurringMapper;
        this.todoMapper = todoMapper;
        this.scriptEvaluator = scriptEvaluator;
    }

    @Override
    public List<RecurringTodo> list(String apiKey) {
        LambdaQueryWrapper<RecurringTodo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(RecurringTodo::getApiKey, apiKey).orderByAsc(RecurringTodo::getNextTriggerAt);
        return recurringMapper.selectList(wrapper);
    }

    @Override
    public RecurringTodo getById(Long id, String apiKey) {
        RecurringTodo rule = recurringMapper.selectById(id);
        if (rule == null || !rule.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "循环任务不存在");
        }
        return rule;
    }

    private void apply(RecurringTodo rule, RecurringTodoRequest request) {
        rule.setTitle(request.getTitle().trim());
        rule.setFrequency(request.getFrequency().trim().toUpperCase());
        rule.setDayOfWeek(request.getDayOfWeek());
        rule.setDayOfMonth(request.getDayOfMonth());
        rule.setTriggerTime(request.getTriggerTime());
        rule.setScript(request.getScript());
        rule.setDdlOffsetMinutes(request.getDdlOffsetMinutes());
        if (request.getEnabled() != null) {
            rule.setEnabled(request.getEnabled());
        }
        if (request.getChainAfterComplete() != null) {
            rule.setChainAfterComplete(request.getChainAfterComplete());
        }
        // 频率相关字段互斥，避免残留脏数据
        if (!RecurringScheduleCalculator.WEEKLY.equals(rule.getFrequency())) {
            rule.setDayOfWeek(null);
        }
        if (!RecurringScheduleCalculator.MONTHLY.equals(rule.getFrequency())) {
            rule.setDayOfMonth(null);
        }
        if (RecurringScheduleCalculator.CUSTOM.equals(rule.getFrequency())) {
            rule.setTriggerTime(null);
            rule.setDayOfWeek(null);
            rule.setDayOfMonth(null);
        } else {
            rule.setScript(null);
        }
        RecurringScheduleCalculator.validate(rule);

        // 自定义脚本必须先试运行通过才允许保存，避免坏脚本进入调度循环
        if (RecurringScheduleCalculator.CUSTOM.equals(rule.getFrequency())) {
            RecurringScriptEvaluator.ScriptResult probe =
                    scriptEvaluator.test(rule.getScript(), LocalDateTime.now(), null);
            if (probe.unavailable()) {
                // 沙箱自身繁忙/已饱和，不是脚本的问题，如实告知并让用户稍后重试
                throw new BusinessException(503, "脚本沙箱暂时不可用：" + probe.error());
            }
            if (!probe.ok()) {
                throw new BusinessException(400, "脚本校验失败：" + probe.error());
            }
        }
    }

    @Override
    public RecurringTodo create(RecurringTodoRequest request, String apiKey) {
        RecurringTodo rule = new RecurringTodo();
        rule.setApiKey(apiKey);
        rule.setEnabled(true);
        rule.setChainAfterComplete(false);
        apply(rule, request);
        rule.setNextTriggerAt(
                RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now()));
        recurringMapper.insert(rule);
        return rule;
    }

    @Override
    public RecurringTodo update(Long id, RecurringTodoRequest request, String apiKey) {
        RecurringTodo rule = getById(id, apiKey);
        apply(rule, request);
        // 规则变了要重算下次触发时间
        rule.setNextTriggerAt(
                RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now()));
        recurringMapper.updateById(rule);
        return rule;
    }

    @Override
    @Transactional
    public void delete(Long id, String apiKey) {
        getById(id, apiKey);
        // 已生成的待办保留，仅解除关联，避免用户丢失历史记录。
        // 必须显式带 apiKey 条件：recurring_id 是全局自增，缺了它这条更新会跨租户命中。
        // updateById 会忽略 null，所以用 lambdaUpdate 显式置空；一次批量更新代替逐行循环。
        todoMapper.update(null, Wrappers.<Todo>lambdaUpdate()
                .eq(Todo::getRecurringId, id)
                .eq(Todo::getApiKey, apiKey)
                .set(Todo::getRecurringId, null));
        recurringMapper.deleteById(id);
    }

    @Override
    public RecurringTodo toggleEnabled(Long id, String apiKey) {
        RecurringTodo rule = getById(id, apiKey);
        boolean next = !Boolean.TRUE.equals(rule.getEnabled());
        LocalDateTime newNext = rule.getNextTriggerAt();
        if (next) {
            // 重新启用时从当前时间往后排，不补历史
            newNext = RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now());
        }
        // 只更新目标列：整行 updateById 会用扫描前的快照覆盖并发的用户修改
        recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, id)
                .set(RecurringTodo::getEnabled, next)
                .set(RecurringTodo::getNextTriggerAt, newNext));
        rule.setEnabled(next);
        rule.setNextTriggerAt(newNext);
        return rule;
    }

    @Override
    @Transactional
    public RecurringTodo triggerNow(Long id, String apiKey) {
        RecurringTodo rule = getById(id, apiKey);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime next = RecurringScheduleCalculator.nextTriggerAfter(rule, now);
        spawnTodo(rule, now);
        // 只更新目标列；CUSTOM 的 next 为 null，用 .set() 才能真的清空（updateById 会忽略 null）
        recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, id)
                .set(RecurringTodo::getLastTriggeredAt, now)
                .set(RecurringTodo::getNextTriggerAt, next));
        rule.setLastTriggeredAt(now);
        rule.setNextTriggerAt(next);
        return rule;
    }

    @Override
    public RecurringScriptEvaluator.ScriptResult testScript(String script) {
        return scriptEvaluator.test(script, LocalDateTime.now(), null);
    }

    /** 按规则生成一条待办，ddl = 触发时刻 + 偏移 */
    private void spawnTodo(RecurringTodo rule, LocalDateTime triggeredAt) {
        Todo todo = new Todo();
        todo.setApiKey(rule.getApiKey());
        todo.setTitle(rule.getTitle());
        todo.setDdl(RecurringScheduleCalculator.ddlOf(rule, triggeredAt));
        todo.setCompleted(false);
        todo.setRecurringId(rule.getId());
        try {
            todoMapper.insert(todo);
        } catch (DuplicateKeyException e) {
            // uk_todo_recurring_ddl 兜底：同一期已存在（多实例并发或异常重放），忽略即可。
            // MySQL 下失败的 INSERT 不会污染当前事务，因此这里可以安全地继续。
            log.warn("Duplicate recurring occurrence ignored: rule={} ddl={}",
                    rule.getId(), todo.getDdl());
        }
    }

    @Override
    @Transactional
    public int generateDueTodos() {
        LocalDateTime now = LocalDateTime.now();
        int generated = generateForFixedRules(now) + generateForCustomRules(now);
        if (generated > 0) {
            log.info("Recurring todos generated: {}", generated);
        }
        return generated;
    }

    /**
     * 自定义脚本规则：每次扫描都执行一次 shouldTrigger(ctx)。
     * 用「同一分钟内不重复触发」做去重，因为调度器每 60s 跑一次，
     * 存在同一分钟被扫到两次的可能。
     */
    private int generateForCustomRules(LocalDateTime now) {
        LambdaQueryWrapper<RecurringTodo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getFrequency, RecurringScheduleCalculator.CUSTOM);

        int generated = 0;
        LocalDateTime minute = now.truncatedTo(ChronoUnit.MINUTES);
        for (RecurringTodo rule : recurringMapper.selectList(wrapper)) {
            if (rule.getLastTriggeredAt() != null
                    && !rule.getLastTriggeredAt().truncatedTo(ChronoUnit.MINUTES).isBefore(minute)) {
                continue;
            }
            RecurringScriptEvaluator.ScriptResult r =
                    scriptEvaluator.test(rule.getScript(), now, rule.getLastTriggeredAt());
            if (!r.ok()) {
                if (r.unavailable()) {
                    // 沙箱自身不可用（并发饱和 / 已有脚本无法终止），这不是规则的问题，
                    // 不能因此把用户的规则停掉
                    log.warn("Custom recurring rule {} skipped, sandbox unavailable: {}",
                            rule.getId(), r.error());
                    continue;
                }
                // 脚本出错则自动停用，避免每分钟反复报错。
                // 只改 enabled：整行 updateById 会把扫描开始时读到的快照写回，
                // 从而覆盖用户在这期间的修改（例如刚把规则改回启用）。
                log.warn("Custom recurring rule {} disabled due to script error: {}",
                        rule.getId(), r.error());
                recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                        .eq(RecurringTodo::getId, rule.getId())
                        .set(RecurringTodo::getEnabled, false));
                continue;
            }
            if (r.triggered()) {
                // 原子占位：以「last_triggered_at 仍早于本分钟」为条件推进，
                // 同一分钟只会有一个扫描能成功，避免重复生成
                if (!claimCustomOccurrence(rule.getId(), minute)) {
                    continue;
                }
                spawnTodo(rule, minute);
                generated++;
            }
        }
        return generated;
    }

    private int generateForFixedRules(LocalDateTime now) {
        LambdaQueryWrapper<RecurringTodo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(RecurringTodo::getEnabled, true)
                .ne(RecurringTodo::getFrequency, RecurringScheduleCalculator.CUSTOM)
                .isNotNull(RecurringTodo::getNextTriggerAt)
                .le(RecurringTodo::getNextTriggerAt, now);

        int generated = 0;
        for (RecurringTodo rule : recurringMapper.selectList(wrapper)) {
            LocalDateTime cursor = rule.getNextTriggerAt();
            int rounds = 0;
            // 补齐停机期间错过的触发点，但设上限防止刷屏。
            // 每一期都「先原子占位（把 next_trigger_at 从本期推进到下一期），再生成待办」，
            // 因此并发的两次扫描（启动补扫与首轮定时任务重叠）或多实例部署都不会重复生成。
            while (cursor != null && !cursor.isAfter(now) && rounds < MAX_CATCH_UP) {
                LocalDateTime next = RecurringScheduleCalculator.nextTriggerAfter(rule, cursor);
                if (!claimFixedOccurrence(rule.getId(), cursor, next)) {
                    break;   // 已被其它扫描/实例抢先占位
                }
                spawnTodo(rule, cursor);
                cursor = next;
                rounds++;
                generated++;
            }
            // 若仍落后于当前时间（错过太多期），带条件地跳到下一个未来触发点
            if (cursor != null && !cursor.isAfter(now)) {
                advanceNextTrigger(rule.getId(), cursor,
                        RecurringScheduleCalculator.nextTriggerAfter(rule, now));
            }
        }
        return generated;
    }

    /** 原子占位一期（固定频率）：仅当 next_trigger_at 仍是扫描时读到的预期值时才推进 */
    private boolean claimFixedOccurrence(Long ruleId, LocalDateTime expectedNext, LocalDateTime newNext) {
        int rows = recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, ruleId)
                .eq(RecurringTodo::getNextTriggerAt, expectedNext)
                .set(RecurringTodo::getNextTriggerAt, newNext)
                .set(RecurringTodo::getLastTriggeredAt, expectedNext));
        return rows == 1;
    }

    /** 原子占位一次（自定义频率）：仅当 last_triggered_at 仍早于本分钟时才推进 */
    private boolean claimCustomOccurrence(Long ruleId, LocalDateTime minute) {
        int rows = recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, ruleId)
                .and(w -> w.isNull(RecurringTodo::getLastTriggeredAt)
                        .or().lt(RecurringTodo::getLastTriggeredAt, minute))
                .set(RecurringTodo::getLastTriggeredAt, minute));
        return rows == 1;
    }

    /** 带条件地推进 next_trigger_at，避免覆盖并发的修改 */
    private void advanceNextTrigger(Long ruleId, LocalDateTime expectedNext, LocalDateTime newNext) {
        recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, ruleId)
                .eq(RecurringTodo::getNextTriggerAt, expectedNext)
                .set(RecurringTodo::getNextTriggerAt, newNext));
    }

    @Override
    @Transactional
    public void onTodoCompleted(Long recurringId, String apiKey) {
        RecurringTodo rule = recurringMapper.selectById(recurringId);
        if (rule == null || !rule.getApiKey().equals(apiKey)) {
            return;
        }
        if (!Boolean.TRUE.equals(rule.getEnabled())
                || !Boolean.TRUE.equals(rule.getChainAfterComplete())) {
            return;
        }
        // 完成即接下一期：以「下次触发时间」为基准生成，保持周期节奏而非从当前时刻起算
        LocalDateTime base = rule.getNextTriggerAt() != null
                ? rule.getNextTriggerAt() : LocalDateTime.now();
        spawnTodo(rule, base);
        // 只更新目标列，避免整行写回覆盖用户并发的修改
        recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, recurringId)
                .set(RecurringTodo::getLastTriggeredAt, LocalDateTime.now())
                .set(RecurringTodo::getNextTriggerAt,
                        RecurringScheduleCalculator.nextTriggerAfter(rule, base)));
    }
}
