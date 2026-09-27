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
import com.timetable.service.RequestValidationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Service
public class RecurringTodoServiceImpl implements RecurringTodoService {

    private static final Logger log = LoggerFactory.getLogger(RecurringTodoServiceImpl.class);

    /** 停机回补上限：单条规则一次最多补生成的期数，避免长期停机后刷出大量待办 */
    private static final int MAX_CATCH_UP = 5;
    /** Custom scripts are replayed over at most the latest ten minutes per rule and scan. */
    private static final int MAX_CUSTOM_CATCH_UP_MINUTES = 10;

    private final RecurringTodoMapper recurringMapper;
    private final TodoMapper todoMapper;
    private final RecurringScriptEvaluator scriptEvaluator;
    private final Clock clock;
    private final RequestValidationService requestValidation;
    private final TransactionTemplate transactionTemplate;

    public RecurringTodoServiceImpl(RecurringTodoMapper recurringMapper, TodoMapper todoMapper,
                                    RecurringScriptEvaluator scriptEvaluator, Clock clock,
                                    RequestValidationService requestValidation,
                                    PlatformTransactionManager transactionManager) {
        this.recurringMapper = recurringMapper;
        this.todoMapper = todoMapper;
        this.scriptEvaluator = scriptEvaluator;
        this.clock = clock;
        this.requestValidation = requestValidation;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
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
        requestValidation.requireValid(request);
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
                    scriptEvaluator.test(rule.getScript(), LocalDateTime.now(clock), null);
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
                RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now(clock)));
        recurringMapper.insert(rule);
        return rule;
    }

    @Override
    public RecurringTodo update(Long id, RecurringTodoRequest request, String apiKey) {
        RecurringTodo rule = getById(id, apiKey);
        apply(rule, request);
        // 规则变了要重算下次触发时间
        rule.setNextTriggerAt(
                RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now(clock)));
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
            newNext = RecurringScheduleCalculator.nextTriggerAfter(rule, LocalDateTime.now(clock));
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
        LocalDateTime now = LocalDateTime.now(clock);
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
        return scriptEvaluator.test(script, LocalDateTime.now(clock), null);
    }

    /** 按规则生成一条待办，ddl = 触发时刻 + 偏移 */
    private boolean spawnTodo(RecurringTodo rule, LocalDateTime triggeredAt) {
        Todo todo = new Todo();
        todo.setApiKey(rule.getApiKey());
        todo.setTitle(rule.getTitle());
        todo.setDdl(RecurringScheduleCalculator.ddlOf(rule, triggeredAt));
        todo.setCompleted(false);
        todo.setChainGenerated(false);
        todo.setRecurringId(rule.getId());
        try {
            todoMapper.insert(todo);
            return true;
        } catch (DuplicateKeyException e) {
            // uk_todo_recurring_ddl 兜底：同一期已存在（多实例并发或异常重放），忽略即可。
            // MySQL 下失败的 INSERT 不会污染当前事务，因此这里可以安全地继续。
            log.warn("Duplicate recurring occurrence ignored: rule={} ddl={}",
                    rule.getId(), todo.getDdl());
            return false;
        }
    }

    @Override
    public int generateDueTodos() {
        LocalDateTime now = LocalDateTime.now(clock);
        int generated = generateForFixedRules(now) + generateForCustomRules(now);
        if (generated > 0) {
            log.info("Recurring todos generated: {}", generated);
        }
        return generated;
    }

    /**
     * Replay unprocessed minute windows so scheduler delays do not silently skip exact-minute rules.
     */
    private int generateForCustomRules(LocalDateTime now) {
        LambdaQueryWrapper<RecurringTodo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getFrequency, RecurringScheduleCalculator.CUSTOM);

        int generated = 0;
        LocalDateTime minute = now.truncatedTo(ChronoUnit.MINUTES);
        for (RecurringTodo rule : recurringMapper.selectList(wrapper)) {
            LocalDateTime expectedCursor = rule.getLastEvaluatedAt();
            LocalDateTime candidate = expectedCursor == null
                    ? minute : expectedCursor.truncatedTo(ChronoUnit.MINUTES).plusMinutes(1);
            LocalDateTime earliest = minute.minusMinutes(MAX_CUSTOM_CATCH_UP_MINUTES - 1L);
            if (candidate.isBefore(earliest)) {
                log.warn("Custom recurring rule {} catch-up window capped at {} minutes",
                        rule.getId(), MAX_CUSTOM_CATCH_UP_MINUTES);
                candidate = earliest;
            }
            if (candidate.isAfter(minute)) {
                continue;
            }
            boolean claimed = false;
            while (!candidate.isAfter(minute)) {
                RecurringScriptEvaluator.ScriptResult result =
                        scriptEvaluator.test(rule.getScript(), candidate, rule.getLastTriggeredAt());
                if (!result.ok()) {
                    if (result.unavailable()) {
                        log.warn("Custom recurring rule {} skipped, sandbox unavailable: {}",
                                rule.getId(), result.error());
                        break;
                    }
                    log.warn("Custom recurring rule {} disabled due to script error: {}",
                            rule.getId(), result.error());
                    recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                            .eq(RecurringTodo::getId, rule.getId())
                            .eq(RecurringTodo::getScript, rule.getScript())
                            .set(RecurringTodo::getEnabled, false));
                    break;
                }
                if (result.triggered()) {
                    LocalDateTime occurrence = candidate;
                    LocalDateTime cursor = expectedCursor;
                    boolean inserted = Boolean.TRUE.equals(transactionTemplate.execute(status -> {
                        if (!claimCustomOccurrence(rule, cursor, occurrence)) return false;
                        return spawnTodo(rule, occurrence);
                    }));
                    if (inserted) {
                        rule.setLastEvaluatedAt(candidate);
                        rule.setLastTriggeredAt(candidate);
                        generated++;
                    }
                    claimed = true;
                    break;
                }
                candidate = candidate.plusMinutes(1);
            }
            if (!claimed && !candidate.isAfter(minute)) {
                // The sandbox was unavailable or a rule failed; do not advance past an unexamined minute.
                continue;
            }
            if (!claimed) {
                transactionTemplate.execute(status ->
                        claimCustomEvaluation(rule, expectedCursor, minute));
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
                LocalDateTime occurrence = cursor;
                Boolean inserted = transactionTemplate.execute(status -> {
                    if (!claimFixedOccurrence(rule, occurrence, next)) return null;
                    return spawnTodo(rule, occurrence);
                });
                if (inserted == null) {
                    break;   // 已被其它扫描/实例抢先占位
                }
                cursor = next;
                rounds++;
                if (inserted) generated++;
            }
            // 若仍落后于当前时间（错过太多期），带条件地跳到下一个未来触发点
            if (cursor != null && !cursor.isAfter(now)) {
                LocalDateTime lateCursor = cursor;
                transactionTemplate.execute(status -> {
                    advanceNextTrigger(rule, lateCursor,
                            RecurringScheduleCalculator.nextTriggerAfter(rule, now));
                    return null;
                });
            }
        }
        return generated;
    }

    /** 原子占位一期（固定频率）：仅当 next_trigger_at 仍是扫描时读到的预期值时才推进 */
    private boolean claimFixedOccurrence(RecurringTodo rule, LocalDateTime expectedNext, LocalDateTime newNext) {
        int rows = recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, rule.getId())
                .eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getFrequency, rule.getFrequency())
                .eq(RecurringTodo::getNextTriggerAt, expectedNext)
                .set(RecurringTodo::getNextTriggerAt, newNext)
                .set(RecurringTodo::getLastTriggeredAt, expectedNext));
        return rows == 1;
    }

    /** Atomically claims one custom-script trigger minute and its evaluation cursor. */
    private boolean claimCustomOccurrence(RecurringTodo rule, LocalDateTime expectedCursor,
                                         LocalDateTime minute) {
        var update = Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, rule.getId())
                .eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getScript, rule.getScript());
        if (expectedCursor == null) {
            update.isNull(RecurringTodo::getLastEvaluatedAt);
        } else {
            update.eq(RecurringTodo::getLastEvaluatedAt, expectedCursor);
        }
        int rows = recurringMapper.update(null, update
                .set(RecurringTodo::getLastEvaluatedAt, minute)
                .set(RecurringTodo::getLastTriggeredAt, minute));
        return rows == 1;
    }

    private boolean claimCustomEvaluation(RecurringTodo rule, LocalDateTime expectedCursor,
                                          LocalDateTime minute) {
        var update = Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, rule.getId())
                .eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getScript, rule.getScript());
        if (expectedCursor == null) {
            update.isNull(RecurringTodo::getLastEvaluatedAt);
        } else {
            update.eq(RecurringTodo::getLastEvaluatedAt, expectedCursor);
        }
        return recurringMapper.update(null, update
                .set(RecurringTodo::getLastEvaluatedAt, minute)) == 1;
    }

    /** 带条件地推进 next_trigger_at，避免覆盖并发的修改 */
    private void advanceNextTrigger(RecurringTodo rule, LocalDateTime expectedNext, LocalDateTime newNext) {
        recurringMapper.update(null, Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, rule.getId())
                .eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getFrequency, rule.getFrequency())
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
                ? rule.getNextTriggerAt() : LocalDateTime.now(clock);
        var claim = Wrappers.<RecurringTodo>lambdaUpdate()
                .eq(RecurringTodo::getId, recurringId)
                .eq(RecurringTodo::getApiKey, apiKey)
                .eq(RecurringTodo::getEnabled, true)
                .eq(RecurringTodo::getChainAfterComplete, true);
        if (rule.getNextTriggerAt() == null) {
            claim.isNull(RecurringTodo::getNextTriggerAt);
        } else {
            claim.eq(RecurringTodo::getNextTriggerAt, rule.getNextTriggerAt());
        }
        if (rule.getLastTriggeredAt() == null) {
            claim.isNull(RecurringTodo::getLastTriggeredAt);
        } else {
            claim.eq(RecurringTodo::getLastTriggeredAt, rule.getLastTriggeredAt());
        }
        if (recurringMapper.update(null, claim
                .set(RecurringTodo::getLastTriggeredAt, base)
                .set(RecurringTodo::getNextTriggerAt,
                        RecurringScheduleCalculator.nextTriggerAfter(rule, base))) == 1) {
            spawnTodo(rule, base);
        }
    }
}
