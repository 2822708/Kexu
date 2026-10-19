package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.config.LlmProperties;
import com.timetable.dto.DailyPlanDto;
import com.timetable.entity.Course;
import com.timetable.entity.AiEvent;
import com.timetable.entity.LlmUsage;
import com.timetable.entity.DailyPlan;
import com.timetable.entity.PeriodConfig;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.DailyPlanMapper;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.CourseService;
import com.timetable.service.DailyPlanService;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.PeriodConfigService;
import com.timetable.service.ScheduleService;
import com.timetable.service.StudentProfileService;
import com.timetable.service.TaskService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.locks.ReentrantLock;

/**
 * AI 每日计划（AI Campus Agent V1.0 Step 6）。
 *
 * 生成即缓存：同一账号同一天只调一次模型，二次请求命中缓存（省 token，首页展示稳定）。
 * 计划不是「AI 自由发挥的作文」：课程块必须与课表逐条一致，任务块只能引用未完成任务，
 * 全天至少一个休息块——这些约束全部由服务端校验，不通过就返回 502 让用户重试，
 * 而不是把一份与课表矛盾的时间线塞给用户。
 */
@Service
public class DailyPlanServiceImpl implements DailyPlanService {

    private static final Logger log = LoggerFactory.getLogger(DailyPlanServiceImpl.class);

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private static final Set<String> ALLOWED_TYPES = Set.of("COURSE", "TASK", "BREAK", "SUGGESTION");
    private static final int MAX_ITEMS = 30;
    private static final int MAX_TITLE_CHARS = 50;
    private static final int MAX_NOTE_CHARS = 50;
    private static final int MAX_SUMMARY_CHARS = 50;

    /**
     * 生成去重锁：key = {@code apiKey@planDate}。
     *
     * <p>用 {@link ConcurrentHashMap} 而不是 Guava/Redis：单机部署（本项目就是单机 + 本地库），
     * 多实例部署前这套缓存本来也不成立。每把锁用完即摘，不会随用户数无限增长。
     */
    private static final ConcurrentHashMap<String, ReentrantLock> GENEATION_LOCKS = new ConcurrentHashMap<>();

    private final DailyPlanMapper mapper;
    private final ScheduleService scheduleService;
    private final CourseService courseService;
    private final TaskService taskService;
    private final PeriodConfigService periodConfigService;
    private final StudentProfileService studentProfileService;
    private final LlmClientRegistry llmClients;
    private final PromptTemplateRegistry promptTemplates;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final JdbcTemplate jdbc;
    private final LlmProperties llmProperties;
    private final AiEventRecorder aiEventRecorder;

    public DailyPlanServiceImpl(DailyPlanMapper mapper, ScheduleService scheduleService,
                                CourseService courseService, TaskService taskService,
                                PeriodConfigService periodConfigService,
                                StudentProfileService studentProfileService,
                                LlmClientRegistry llmClients, PromptTemplateRegistry promptTemplates,
                                ObjectMapper objectMapper, Clock clock, JdbcTemplate jdbc,
                                LlmProperties llmProperties, AiEventRecorder aiEventRecorder) {
        this.mapper = mapper;
        this.scheduleService = scheduleService;
        this.courseService = courseService;
        this.taskService = taskService;
        this.periodConfigService = periodConfigService;
        this.studentProfileService = studentProfileService;
        this.llmClients = llmClients;
        this.promptTemplates = promptTemplates;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.jdbc = jdbc;
        this.llmProperties = llmProperties;
        this.aiEventRecorder = aiEventRecorder;
    }

    @Override
    public DailyPlanDto get(String apiKey, LocalDate date) {
        if (apiKey == null || apiKey.isBlank()) {
            return null;
        }
        DailyPlan stored = select(apiKey, date == null ? LocalDate.now(clock) : date);
        if (stored == null) {
            return null;
        }
        DailyPlanDto dto = toDto(stored, true);
        // 输入数据变过就提示「可能过时」，但不自动重算——重新生成要花 token，决定权交给用户
        dto.setStale(inputChangedSince(apiKey, stored.getCreatedAt()));
        return dto;
    }

    /**
     * 计划生成之后，课程/考试/任务/档案是否又改过。
     *
     * 用「数据最后更新时间 > 计划生成时间」判断，不需要额外表字段：
     * daily_plan 只有 created_at，而各输入表都有 ON UPDATE 的 updated_at。
     * 判定偏保守（改了下周的课也会提示），但宁可多提示一次，也不要让用户对着过时的计划安排一天。
     */
    private boolean inputChangedSince(String apiKey, LocalDateTime since) {
        if (since == null) {
            return false;
        }
        LocalDateTime latest = latestChange(apiKey);
        return latest != null && latest.isAfter(since);
    }

    private LocalDateTime latestChange(String apiKey) {
        // 任何一个来源都没有数据时 MAX() 返回 null，因此逐个累加而不是 List.of（不允许 null 元素）
        String[] queries = {
                "SELECT MAX(c.updated_at) FROM course c JOIN schedule s ON c.schedule_id = s.id "
                        + "WHERE s.api_key = ?",
                "SELECT MAX(e.updated_at) FROM exam e JOIN schedule s ON e.schedule_id = s.id "
                        + "WHERE s.api_key = ?",
                "SELECT MAX(updated_at) FROM task WHERE api_key = ?",
                "SELECT MAX(updated_at) FROM student_profile WHERE api_key = ?",
        };
        LocalDateTime latest = null;
        for (String sql : queries) {
            LocalDateTime candidate = maxUpdatedAt(sql, apiKey);
            if (candidate != null && (latest == null || candidate.isAfter(latest))) {
                latest = candidate;
            }
        }
        return latest;
    }

    private LocalDateTime maxUpdatedAt(String sql, String apiKey) {
        try {
            return jdbc.queryForObject(sql, LocalDateTime.class, apiKey);
        } catch (Exception e) {
            // 表或列缺失（旧库）不该让首页挂掉：拿不到更新时间就当作没变
            log.warn("读取每日计划输入变更时间失败，按未变更处理: {}", e.toString());
            return null;
        }
    }

    @Override
    public DailyPlanDto generate(String apiKey, Long scheduleId, LocalDate date) {
        LocalDate planDate = date == null ? LocalDate.now(clock) : date;

        // 同一账号同一天只允许一个请求真正干活：否则「首页 + 用户手点」并发进来会各调一次模型
        // （重复烧 token），最后还有两行同时 insert 撞 uk(api_key, plan_date)。
        // 分段加锁而不是把方法整体 synchronized：不同用户、不同日期互不排队。
        String slot = apiKey + "@" + planDate;
        ReentrantLock lock = GENEATION_LOCKS.computeIfAbsent(slot, key -> new ReentrantLock());
        lock.lock();
        try {
            return generateExclusive(apiKey, scheduleId, planDate);
        } finally {
            lock.unlock();
            // 必须与 unlock 同线程判断：等锁的线程此刻还没进排队队列，
            // 若它随后进入会被下面的 remove 挤掉锁对象，导致后续请求拿到一把新锁而失序。
            if (!lock.hasQueuedThreads()) {
                GENEATION_LOCKS.remove(slot, lock);
            }
        }
    }

    /** 持锁执行：缓存 → 取输入 → 调模型（带退避重试）→ 校验 → 落库。 */
    private DailyPlanDto generateExclusive(String apiKey, Long scheduleId, LocalDate planDate) {
        // 拿到锁后必须重查缓存：可能刚有同一天的请求生成完，直接复用即可
        DailyPlan cached = select(apiKey, planDate);
        if (cached != null) {
            if (!inputChangedSince(apiKey, cached.getCreatedAt())) {
                return toDto(cached, true);
            }
            // ⚠️ 旧行先不删：删了之后若模型连续失败，用户会从「有份旧计划可看」变成「什么都没有」。
            // 改成等新计划落库成功再删（见下方 replaceCached）。
        }

        PromptTemplateRegistry.PromptTemplate template = promptTemplates.get("daily-plan");
        if (template == null || template.body().isBlank()) {
            throw new BusinessException(500, "每日计划模板缺失，无法生成计划");
        }
        // 未配置 / 全 provider 不可用时由注册表统一抛 503（与聊天、抽取一致的降级文案）
        LlmClient client = llmClients.forScene(LlmUsage.SCENE_PLAN);

        Long effectiveScheduleId = scheduleId;
        Schedule schedule = null;
        if (effectiveScheduleId == null) {
            effectiveScheduleId = scheduleService.list(apiKey).stream()
                    .findFirst().map(Schedule::getId).orElse(null);
        }
        if (effectiveScheduleId != null) {
            schedule = scheduleService.getById(effectiveScheduleId, apiKey);
        }

        List<PeriodConfig> periods = periodConfigService.list();
        List<Course> todayCourses = todayCourses(schedule, planDate, apiKey);
        // 计划要看到全部未完成任务（含远期截止），由模型按优先级与截止决定今天推进哪些；
        // 不能用聊天的 14 天窗口——那只是聊天上下文的预算裁剪，会把下周的任务提前藏起来
        List<Task> openTasks = taskService.list(apiKey).stream()
                .filter(task -> Task.STATUS_PENDING.equals(task.getStatus())
                        || Task.STATUS_IN_PROGRESS.equals(task.getStatus()))
                .limit(MAX_ITEMS)
                .toList();
        StudentProfile profile = studentProfileService.find(apiKey);

        String input = AiPromptBuilder.buildDailyPlanInput(
                planDate, schedule, todayCourses, periods, openTasks, profile);
        List<LlmClient.Message> messages = List.of(
                new LlmClient.Message("system", template.body()),
                new LlmClient.Message("user", input));

        // 模型输出不合规是**常态**而非故障（尤其时间格式、漏课、忘排休息），
        // 一次就放弃等于把可恢复的抖动直接变成用户的失败。重试期间输入数据不变，
        // 因此只需要重新调用与校验，不必重建上下文。
        DailyPlanDto generated = generateWithRetry(client, messages, todayCourses, openTasks, periods);

        DailyPlan plan = new DailyPlan();
        plan.setApiKey(apiKey);
        plan.setPlanDate(planDate);
        plan.setContent(serializeItems(generated.getItems()));
        plan.setSummary(generated.getSummary());
        plan.setCreatedAt(LocalDateTime.now(clock));
        replaceCached(cached, plan);

        // 只有走到这里才是「真的调了模型、落了库」。缓存命中在上面就 return 了，
        // 那种情况用户没花 token，也不构成一次新的「让学长排一天」，不能计入采纳率分母。
        aiEventRecorder.record(apiKey, AiEvent.TYPE_PLAN_GENERATED, LlmUsage.SCENE_PLAN,
                null, plan.getId());

        DailyPlanDto dto = new DailyPlanDto();
        dto.setDate(planDate);
        dto.setItems(generated.getItems());
        dto.setSummary(generated.getSummary());
        dto.setCached(false);
        return dto;
    }

    /**
     * 调用 + 校验，失败按退避重试。
     *
     * <p>只重试 {@link #retryable(BusinessException) 可重试} 的失败；其余（含 499 客户端断开）
     * 立即抛出，不做无意义等待。次数与间隔由 {@code app.llm.plan-retry.*} 控制，
     * {@code enabled=false} 时退化为 V1.0 的一次性行为。
     */
    private DailyPlanDto generateWithRetry(LlmClient client, List<LlmClient.Message> messages,
                                           List<Course> todayCourses, List<Task> openTasks,
                                           List<PeriodConfig> periods) {
        LlmProperties.PlanRetry policy = llmProperties.getPlanRetry();
        int maxAttempts = policy.isEnabled() ? Math.max(1, policy.getMaxAttempts()) : 1;
        BusinessException last = null;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                JsonNode root = parseJsonOrFail(client.chatJson(LlmUsage.SCENE_PLAN, messages));
                List<DailyPlanDto.DailyPlanItem> items =
                        toValidatedItems(root, todayCourses, openTasks, periods);
                DailyPlanDto dto = new DailyPlanDto();
                dto.setItems(items);
                dto.setSummary(truncate(root.path("summary").asText(""), MAX_SUMMARY_CHARS));
                if (attempt > 1) {
                    log.info("每日计划第 {} 次尝试通过校验（前序失败：{}）", attempt, last.getMessage());
                }
                return dto;
            } catch (BusinessException failure) {
                if (!retryable(failure)) {
                    throw failure;
                }
                last = failure;
                if (attempt == maxAttempts) {
                    break;
                }
                long delay = backoffMillis(policy, attempt);
                log.warn("每日计划生成失败（第 {}/{} 次，{}ms 后重试）：{}",
                        attempt, maxAttempts, delay, failure.getMessage());
                if (!sleepFor(delay)) {
                    // 等待期间线程被中断（服务正在停机）：别再调模型，如实抛出
                    Thread.currentThread().interrupt();
                    throw failure;
                }
            }
        }
        log.warn("每日计划连续 {} 次未通过校验，放弃重试：{}", maxAttempts, last.getMessage());
        throw last;
    }

    /**
     * 哪些失败值得重试。
     *
     * <p>502 = 模型这次输出没通过校验（换个采样很可能就好了，这是重试的主战场）；
     * 503/504 = 上游繁忙或超时；其余 4xx/5xx 是「配置或代码问题」，重试解决不了。
     */
    private boolean retryable(BusinessException failure) {
        int code = failure.getCode();
        return code == 502 || code == 503 || code == 504;
    }

    /** {@code initial * 2^(attempt-1)}，封顶 {@code max}，再加一点抖动打散重试尖峰。 */
    private long backoffMillis(LlmProperties.PlanRetry policy, int attempt) {
        long base = Math.max(0L, policy.getInitialBackoffMs());
        int shift = Math.min(attempt - 1, 16); // 防止移位溢出
        long delay = base << shift;
        long cap = policy.getMaxBackoffMs();
        if (cap > 0 && delay > cap) {
            delay = cap;
        }
        long jitter = Math.max(0L, policy.getJitterMs());
        if (jitter > 0) {
            delay += ThreadLocalRandom.current().nextLong(jitter + 1);
        }
        return delay;
    }

    /** @return false 表示等待被中断 */
    private boolean sleepFor(long millis) {
        if (millis <= 0) {
            return true;
        }
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            return false;
        }
    }

    /**
     * 写新计划，并把过期旧计划删掉。
     *
     * <p>顺序是「先插后删」而不是「先删后插」：模型连续失败时旧计划还在，用户至少还有东西可看。
     * 兜底再按 (api_key, plan_date) 删一次，清掉历史遗留的重复行。
     */
    private void replaceCached(DailyPlan stale, DailyPlan fresh) {
        if (stale != null && stale.getId() != null) {
            mapper.deleteById(stale.getId());
        }
        mapper.insert(fresh);
        mapper.delete(new LambdaQueryWrapper<DailyPlan>()
                .eq(DailyPlan::getApiKey, fresh.getApiKey())
                .eq(DailyPlan::getPlanDate, fresh.getPlanDate())
                .ne(DailyPlan::getId, fresh.getId()));
    }

    // ==================== 校验 ====================

    /**
     * 计划校验：不合规直接 502（宁可让用户重试，也不给出与课表矛盾的时间线）。
     *
     * 校验项：块类型白名单、时间格式与先后、课程块与课表逐条一致（含起止时刻与不漏课）、
     * 任务块只引用未完成任务、至少一个休息块。最后按开始时刻升序排列。
     */
    private List<DailyPlanDto.DailyPlanItem> toValidatedItems(JsonNode root, List<Course> todayCourses,
                                                              List<Task> openTasks,
                                                              List<PeriodConfig> periods) {
        JsonNode itemsNode = root.path("items");
        if (!itemsNode.isArray() || itemsNode.isEmpty()) {
            throw new BusinessException(502, "AI 返回的计划缺少时间线，请重试");
        }
        if (itemsNode.size() > MAX_ITEMS) {
            throw new BusinessException(502, "AI 返回的计划过长，请重试");
        }

        Map<Long, Course> courseById = new HashMap<>();
        for (Course course : todayCourses) {
            if (course.getId() != null) {
                courseById.put(course.getId(), course);
            }
        }
        Set<Long> openTaskIds = new LinkedHashSet<>();
        for (Task task : openTasks) {
            if (task.getId() != null) {
                openTaskIds.add(task.getId());
            }
        }
        Set<Long> coveredCourses = new LinkedHashSet<>();
        List<DailyPlanDto.DailyPlanItem> items = new ArrayList<>();
        boolean hasBreak = false;

        for (JsonNode node : itemsNode) {
            String type = node.path("type").asText("").trim().toUpperCase();
            if (!ALLOWED_TYPES.contains(type)) {
                throw new BusinessException(502, "AI 返回的计划含未知块类型，请重试");
            }
            LocalTime start = parseTime(node.path("start").asText(""));
            LocalTime end = parseTime(node.path("end").asText(""));
            if (start == null || end == null) {
                throw new BusinessException(502, "AI 返回的计划时间格式不正确，请重试");
            }
            if (!end.isAfter(start)) {
                throw new BusinessException(502, "AI 返回的计划存在无效时间段，请重试");
            }
            String title = node.path("title").asText("").trim();
            if (title.isEmpty()) {
                title = defaultTitle(type);
            }
            // 注意：三元表达式里混用 long 与 null 会触发自动拆箱 NPE，必须显式分支
            Long refId = null;
            if (node.path("ref_id").isIntegralNumber()) {
                refId = node.path("ref_id").asLong();
            } else if (node.path("refId").isIntegralNumber()) {
                refId = node.path("refId").asLong();
            }

            if ("COURSE".equals(type)) {
                Course course = refId == null ? null : courseById.get(refId);
                if (course == null) {
                    throw new BusinessException(502, "AI 返回的计划引用了今天不存在的课程，请重试");
                }
                String expected = AiPromptBuilder.courseTimeRange(course, periods);
                String actual = start.format(TIME_FMT) + "-" + end.format(TIME_FMT);
                if (!expected.equals(actual)) {
                    throw new BusinessException(502, "AI 返回的课程时间与课表不一致，请重试");
                }
                coveredCourses.add(refId);
            } else if ("TASK".equals(type)) {
                if (refId == null || !openTaskIds.contains(refId)) {
                    throw new BusinessException(502, "AI 返回的计划引用了不存在或已完成的任务，请重试");
                }
            } else if ("BREAK".equals(type)) {
                hasBreak = true;
            }

            DailyPlanDto.DailyPlanItem item = new DailyPlanDto.DailyPlanItem();
            item.setType(type);
            item.setTitle(truncate(title, MAX_TITLE_CHARS));
            item.setStart(start.format(TIME_FMT));
            item.setEnd(end.format(TIME_FMT));
            item.setRefId(refId);
            item.setNote(truncate(node.path("note").asText(""), MAX_NOTE_CHARS));
            items.add(item);
        }

        // 课程块必须与课表一致：今天的每一门课都要出现
        for (Course course : todayCourses) {
            if (course.getId() != null && !coveredCourses.contains(course.getId())) {
                throw new BusinessException(502, "AI 返回的计划遗漏了今天的课程，请重试");
            }
        }
        if (!hasBreak) {
            throw new BusinessException(502, "AI 返回的计划没有安排休息，请重试");
        }

        // 按 HH:mm 字符串排序：格式定宽，字典序即时间序。不用 a.getStart() 直接比较——
        // 拿的是 String，之前那版 sort 依赖时间解析结果，模型给出畸形时间时会 NPE 到 500。
        items.sort(Comparator.comparing(DailyPlanDto.DailyPlanItem::getStart));
        return items;
    }

    // ==================== 辅助 ====================

    private DailyPlan select(String apiKey, LocalDate date) {
        return mapper.selectOne(new LambdaQueryWrapper<DailyPlan>()
                .eq(DailyPlan::getApiKey, apiKey)
                .eq(DailyPlan::getPlanDate, date)
                .last("LIMIT 1"));
    }

    private List<Course> todayCourses(Schedule schedule, LocalDate date, String apiKey) {
        if (schedule == null) {
            return List.of();
        }
        int currentWeek = AiPromptBuilder.weekOf(schedule.getPeriodStartDate(), date);
        List<Course> result = new ArrayList<>();
        for (Course course : courseService.listByScheduleId(schedule.getId(), apiKey)) {
            boolean dayHit = course.getDayOfWeek() != null
                    && course.getDayOfWeek() == date.getDayOfWeek().getValue();
            boolean weekHit = course.getWeeks() == null || course.getWeeks().contains(currentWeek);
            if (dayHit && weekHit) {
                result.add(course);
            }
        }
        result.sort((a, b) -> a.getStartPeriod() == null || b.getStartPeriod() == null
                ? 0 : Integer.compare(a.getStartPeriod(), b.getStartPeriod()));
        return result;
    }

    private JsonNode parseJsonOrFail(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.startsWith("```")) {
            int start = text.indexOf('\n');
            int end = text.lastIndexOf("```");
            if (start > 0 && end > start) {
                text = text.substring(start + 1, end).trim();
            }
        }
        try {
            return objectMapper.readTree(text);
        } catch (Exception ignored) {
            int first = text.indexOf('{');
            int last = text.lastIndexOf('}');
            if (first >= 0 && last > first) {
                try {
                    return objectMapper.readTree(text.substring(first, last + 1));
                } catch (Exception ignored2) {
                    // 落到下面的统一报错
                }
            }
        }
        throw new BusinessException(502, "AI 未返回可解析的计划，请重试");
    }

    private LocalTime parseTime(String value) {
        String v = value == null ? "" : value.trim();
        if (v.isEmpty()) {
            return null;
        }
        try {
            return LocalTime.parse(v.length() == 4 ? "0" + v : v);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String serializeItems(List<DailyPlanDto.DailyPlanItem> items) {
        ObjectNode root = objectMapper.createObjectNode();
        ArrayNode array = root.putArray("items");
        for (DailyPlanDto.DailyPlanItem item : items) {
            ObjectNode node = array.addObject();
            node.put("type", item.getType());
            node.put("title", item.getTitle());
            node.put("start", item.getStart());
            node.put("end", item.getEnd());
            if (item.getRefId() != null) {
                node.put("refId", item.getRefId());
            }
            node.put("note", item.getNote());
        }
        try {
            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new BusinessException(500, "计划保存失败");
        }
    }

    private DailyPlanDto toDto(DailyPlan stored, boolean cached) {
        DailyPlanDto dto = new DailyPlanDto();
        dto.setDate(stored.getPlanDate());
        dto.setSummary(stored.getSummary());
        dto.setCached(cached);
        dto.setItems(readItems(stored.getContent()));
        return dto;
    }

    /** 缓存内容 → 时间线；缓存损坏视为未生成（不抛错，用户可重新生成）。 */
    private List<DailyPlanDto.DailyPlanItem> readItems(String content) {
        if (content == null || content.isBlank()) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(content);
            List<DailyPlanDto.DailyPlanItem> items = new ArrayList<>();
            for (JsonNode node : root.path("items")) {
                DailyPlanDto.DailyPlanItem item = new DailyPlanDto.DailyPlanItem();
                item.setType(node.path("type").asText("SUGGESTION"));
                item.setTitle(node.path("title").asText(""));
                item.setStart(node.path("start").asText(""));
                item.setEnd(node.path("end").asText(""));
                item.setRefId(node.path("refId").isIntegralNumber() ? node.path("refId").asLong() : null);
                item.setNote(node.path("note").asText(""));
                items.add(item);
            }
            return items;
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String defaultTitle(String type) {
        return switch (type) {
            case "COURSE" -> "上课";
            case "TASK" -> "推进任务";
            case "BREAK" -> "休息";
            default -> "自由安排";
        };
    }

    private static String truncate(String value, int limit) {
        if (value == null) return "";
        return value.length() <= limit ? value : value.substring(0, limit);
    }
}
