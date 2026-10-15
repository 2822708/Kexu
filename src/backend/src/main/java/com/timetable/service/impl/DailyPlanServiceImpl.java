package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.dto.DailyPlanDto;
import com.timetable.entity.Course;
import com.timetable.entity.DailyPlan;
import com.timetable.entity.PeriodConfig;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.DailyPlanMapper;
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
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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

    public DailyPlanServiceImpl(DailyPlanMapper mapper, ScheduleService scheduleService,
                                CourseService courseService, TaskService taskService,
                                PeriodConfigService periodConfigService,
                                StudentProfileService studentProfileService,
                                LlmClientRegistry llmClients, PromptTemplateRegistry promptTemplates,
                                ObjectMapper objectMapper, Clock clock, JdbcTemplate jdbc) {
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

        // 同一天重复点「生成」默认复用，避免重复烧 token。
        // 但计划已被标记 stale（输入数据变过）时，用户主动点生成就是要重算——删掉旧行继续。
        // 分工：get() 只读永不烧 token，只提示；generate() 由用户主动触发，允许真正重算。
        DailyPlan cached = select(apiKey, planDate);
        if (cached != null) {
            if (!inputChangedSince(apiKey, cached.getCreatedAt())) {
                return toDto(cached, true);
            }
            mapper.delete(new LambdaQueryWrapper<DailyPlan>()
                    .eq(DailyPlan::getApiKey, apiKey)
                    .eq(DailyPlan::getPlanDate, planDate));
        }

        PromptTemplateRegistry.PromptTemplate template = promptTemplates.get("daily-plan");
        if (template == null || template.body().isBlank()) {
            throw new BusinessException(500, "每日计划模板缺失，无法生成计划");
        }
        // 未配置 / 全 provider 不可用时由注册表统一抛 503（与聊天、抽取一致的降级文案）
        LlmClient client = llmClients.active();

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
        JsonNode root = parseJsonOrFail(client.chatJson(List.of(
                new LlmClient.Message("system", template.body()),
                new LlmClient.Message("user", input))));

        List<DailyPlanDto.DailyPlanItem> items = toValidatedItems(root, todayCourses, openTasks, periods);
        String summary = truncate(root.path("summary").asText(""), MAX_SUMMARY_CHARS);

        DailyPlan plan = new DailyPlan();
        plan.setApiKey(apiKey);
        plan.setPlanDate(planDate);
        plan.setContent(serializeItems(items));
        plan.setSummary(summary);
        plan.setCreatedAt(LocalDateTime.now(clock));
        mapper.insert(plan);

        DailyPlanDto dto = new DailyPlanDto();
        dto.setDate(planDate);
        dto.setItems(items);
        dto.setSummary(summary);
        dto.setCached(false);
        return dto;
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

        items.sort((a, b) -> a.getStart().compareTo(b.getStart()));
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
