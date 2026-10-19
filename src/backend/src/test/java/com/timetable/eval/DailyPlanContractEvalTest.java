package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.dto.CourseRequest;
import com.timetable.dto.DailyPlanDto;
import com.timetable.dto.PeriodConfigRequest;
import com.timetable.dto.ScheduleRequest;
import com.timetable.dto.TaskDraft;
import com.timetable.entity.Schedule;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.service.CourseService;
import com.timetable.service.DailyPlanService;
import com.timetable.service.LlmClient;
import com.timetable.service.PeriodConfigService;
import com.timetable.service.ScheduleService;
import com.timetable.service.TaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static com.timetable.eval.ModelEvalSupport.toJson;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 契约层：每日计划的「模型输出 → 服务端校验」归约（6.2 #7）。
 *
 * <p>这是五个场景里唯一有<b>拒绝语义</b>的一条：校验不通过必须抛 502 让用户重试，
 * 而不是「尽力修一修照常展示」。理由是这类错误会产出一条与真实课表矛盾的时间线，
 * 用户按它安排一天等于被误导——宁可不给，也不给错的。
 *
 * <p>所以用例分成两类：合规输出要保留原样（含排序、默认标题、refId 兼容），
 * 不合规输出要被拦下，且拦截原因要能对上。
 */
@ActiveProfiles(ModelEvalSupport.PROFILE)
@SpringBootTest(classes = ModelEvalSupport.EvalApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:model_eval_plan;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN",
        // 校验失败即为最终结果，关掉重试以免同一个坏输出被反复调用
        "app.llm.plan-retry.enabled=false"
})
class DailyPlanContractEvalTest {

    private static final String OWNER = "eval-plan-owner";
    private static final JsonNode FIXTURE = loadFixture();
    /** 2026-09-28 是周一：用例里的课程全部挂在周一。 */
    private static final LocalDate MONDAY = LocalDate.of(2026, 9, 28);

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired CourseService courses;
    @Autowired PeriodConfigService periods;
    @Autowired TaskService tasks;
    @Autowired DailyPlanService plans;
    @MockBean LlmClient provider;

    /** 装配时生成的真实 id，顺序与用例文件里的 courses / tasks 数组一致。 */
    private final List<Long> courseIds = new ArrayList<>();
    private final List<Long> taskIds = new ArrayList<>();

    private static JsonNode loadFixture() {
        try {
            return ModelEvalSupport.loadFixture("daily-plan");
        } catch (Exception e) {
            throw new IllegalStateException("加载 daily-plan 用例失败", e);
        }
    }

    static Stream<JsonNode> cases() {
        return ModelEvalSupport.cases(FIXTURE).stream();
    }

    @BeforeEach
    void seedContext() {
        for (String table : List.of("daily_plan", "task", "course", "exam", "todo", "recurring_todo",
                "schedule", "api_key", "student_profile", "student_memory",
                "ai_action", "ai_message", "ai_conversation")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Eval owner");
        when(provider.isConfigured()).thenReturn(true);
        courseIds.clear();
        taskIds.clear();

        seedPeriods();
        Schedule schedule = seedSchedule();
        seedCourses(schedule);
        seedTasks();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    @DisplayName("模型输出 → 时间线校验")
    void modelOutputIsValidatedIntoValidatedTimeline(JsonNode evalCase) {
        String caseId = evalCase.path("id").asText();
        // 用例里的 ref_id 是「序号占位」（course#1 / task#2 / course#missing），
        // 执行前映射成本次装配真正生成的数据库 id——自增 id 每次跑都可能不同，
        // 写死数字会让用例在换库、换顺序时莫名其妙全红。
        when(provider.chatJson(any(), any())).thenReturn(toJson(resolveRefs(evalCase.path("raw"))));

        if (evalCase.has("expectError")) {
            String expectedReason = evalCase.path("expectError").asText();
            assertThatThrownBy(() -> plans.generate(OWNER, null, MONDAY))
                    .as("用例 %s 期望被拦下（原因含「%s」），实际却通过了", caseId, expectedReason)
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining(expectedReason);
            // 被拦下的计划绝不能落库：否则下次读缓存会读到一份从未通过校验的时间线
            assertThat(sql.queryForObject("SELECT COUNT(*) FROM daily_plan", Integer.class))
                    .as("用例 %s 被拒绝后不该留下 daily_plan 记录", caseId)
                    .isZero();
            return;
        }

        DailyPlanDto plan = plans.generate(OWNER, null, MONDAY);
        JsonNode expect = evalCase.path("expect");
        List<DailyPlanDto.DailyPlanItem> items = plan.getItems();

        assertThat(items)
                .as(ModelEvalSupport.failMessage(caseId, "块数", expect.path("itemCount").asInt(), items.size()))
                .hasSize(expect.path("itemCount").asInt());

        if (expect.has("summary")) {
            assertThat(plan.getSummary())
                    .as(ModelEvalSupport.failMessage(caseId, "总评",
                            expect.path("summary").asText(), plan.getSummary()))
                    .isEqualTo(expect.path("summary").asText());
        }
        if (expect.has("types")) {
            assertThat(items)
                    .extracting(DailyPlanDto.DailyPlanItem::getType)
                    .as("用例 %s 的块类型序列不符", caseId)
                    .containsExactlyElementsOf(textList(expect.path("types")));
        }
        if (expect.has("starts")) {
            assertThat(items)
                    .extracting(DailyPlanDto.DailyPlanItem::getStart)
                    .as("用例 %s 的开始时刻序列不符（服务端必须按 start 升序重排）", caseId)
                    .containsExactlyElementsOf(textList(expect.path("starts")));
        }
        if (expect.has("titlesNotEmpty")) {
            assertThat(items)
                    .as("用例 %s 存在空标题块，前端会渲染出一个空白行", caseId)
                    .allSatisfy(item -> assertThat(item.getTitle()).isNotBlank());
        }
        if (expect.has("refIds")) {
            List<Long> expected = new ArrayList<>();
            for (JsonNode node : expect.path("refIds")) {
                if (node.isNull()) {
                    expected.add(null);
                } else if (node.isTextual()) {
                    // 期望值也写的是占位符，必须和输入同样映射，否则比的是「字符串 vs id」
                    String token = node.asText();
                    expected.add(token.startsWith("course#")
                            ? resolve(token, "course#", courseIds)
                            : resolve(token, "task#", taskIds));
                } else {
                    expected.add(node.asLong());
                }
            }
            assertThat(items)
                    .extracting(DailyPlanDto.DailyPlanItem::getRefId)
                    .as("用例 %s 的 refId 序列不符（驼峰 refId 也必须被识别）", caseId)
                    .containsExactlyElementsOf(expected);
        }
        if (expect.has("titleLengthsAtMost")) {
            assertThat(items)
                    .as("用例 %s 存在超长标题", caseId)
                    .allSatisfy(item -> assertThat(item.getTitle().length())
                            .isLessThanOrEqualTo(expect.path("titleLengthsAtMost").asInt()));
        }
        if (expect.has("noteLengthsAtMost")) {
            int noteLimit = expect.path("noteLengthsAtMost").asInt();
            assertThat(items)
                    .as("用例 %s 存在超长备注", caseId)
                    .allSatisfy(item -> {
                        // 三元表达式里混用 String 与 int 会被统一成 Object，无法比较，
                        // 必须显式取长度——这里和 DailyPlanServiceImpl 里踩过的是同一个坑
                        String note = item.getNote() == null ? "" : item.getNote();
                        assertThat(note.length()).isLessThanOrEqualTo(noteLimit);
                    });
        }
        if (expect.has("summaryLengthAtMost")) {
            assertThat(plan.getSummary().length())
                    .as("用例 %s 的总评超长（上限 %d 字）", caseId, expect.path("summaryLengthAtMost").asInt())
                    .isLessThanOrEqualTo(expect.path("summaryLengthAtMost").asInt());
        }
    }

    private List<String> textList(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode node : array) {
            out.add(node.asText());
        }
        return out;
    }

    /**
     * 把用例里的 ref_id 占位符映射成真实 id。
     *
     * <p>{@code course#N} / {@code task#N} 表示「装配时创建的第 N 个课程 / 任务」，
     * {@code #missing} 表示故意指向一条不存在的记录（用于「引用了不存在的课程」这类拒绝用例）。
     * 驼峰 {@code refId} 必须原样保留——DP-14 专门验的就是服务端两种写法都要认。
     */
    private JsonNode resolveRefs(JsonNode raw) {
        JsonNode copy = raw.deepCopy();
        if (!copy.path("items").isArray()) {
            return copy;
        }
        for (JsonNode item : copy.path("items")) {
            if (!(item instanceof ObjectNode node)) {
                continue;
            }
            for (String field : List.of("ref_id", "refId")) {
                JsonNode value = node.get(field);
                if (value == null || !value.isTextual()) {
                    continue;
                }
                String token = value.asText();
                if (token.startsWith("course#")) {
                    node.put(field, resolve(token, "course#", courseIds));
                } else if (token.startsWith("task#")) {
                    node.put(field, resolve(token, "task#", taskIds));
                }
            }
        }
        return copy;
    }

    /**
     * 解析 {@code prefix + 序号}。{@code missing} 返回一个必定不存在的 id：
     * 取「当前最大 id + 1000」，绝不会和真实自增 id 撞上。
     */
    private long resolve(String token, String prefix, List<Long> ids) {
        String suffix = token.substring(prefix.length());
        if ("missing".equals(suffix)) {
            return ids.stream().mapToLong(Long::longValue).max().orElse(0L) + 1000L;
        }
        int index = Integer.parseInt(suffix) - 1;
        assertThat(ids)
                .as("用例引用了 %s，但装配时只创建了 %d 条", token, ids.size())
                .hasSizeGreaterThan(index);
        return ids.get(index);
    }

    // --- 上下文装配：数据全部取自用例文件 --------------------------------

    private void seedPeriods() {
        // 作息表由 V1 迁移预置了 12 节，但 PeriodConfigService.update 需要管理员权限。
        // 评估集只需要「可预期的时刻表」，直接 SQL 覆盖即可——不为了拿权限把 admin key
        // 塞进普通用户路径，那会让被测链路和线上不一致。
        for (JsonNode period : FIXTURE.path("periods")) {
            int number = period.path("number").asInt();
            sql.update("UPDATE period_config SET start_time=?, end_time=? WHERE period_number=?",
                    period.path("start").asText(), period.path("end").asText(), number);
        }
        // 用例只用到前 6 节，其余节次清空以免课程时刻换算撞上残留配置
        sql.update("DELETE FROM period_config WHERE period_number > ?", FIXTURE.path("periods").size());
    }

    private Schedule seedSchedule() {
        ScheduleRequest req = new ScheduleRequest();
        req.setName("评估用课表");
        req.setPeriodStartDate(MONDAY.minusWeeks(3));
        req.setPeriodEndDate(MONDAY.plusWeeks(18));
        return schedules.create(req, OWNER);
    }

    private void seedCourses(Schedule schedule) {
        for (JsonNode node : FIXTURE.path("courses")) {
            CourseRequest req = new CourseRequest();
            req.setName(node.path("name").asText());
            req.setDayOfWeek(node.path("dayOfWeek").asInt());
            req.setStartPeriod(node.path("startPeriod").asInt());
            req.setEndPeriod(node.path("endPeriod").asInt());
            List<Integer> weeks = new ArrayList<>();
            node.path("weeks").forEach(w -> weeks.add(w.asInt()));
            req.setWeeks(weeks);
            if (node.hasNonNull("location")) {
                req.setLocation(node.path("location").asText());
            }
            courseIds.add(courses.create(schedule.getId(), req, OWNER).getId());
        }
    }

    private void seedTasks() {
        for (JsonNode node : FIXTURE.path("tasks")) {
            // TaskService.create 收的是 TaskDraft（与 AI 抽取产物同一入口），
            // 这样「评估用的任务」和「线上真实任务」走完全一样的落库路径。
            TaskDraft draft = new TaskDraft();
            draft.setTitle(node.path("title").asText());
            draft.setType(node.path("type").asText());
            draft.setPriority(node.path("priority").asInt());
            draft.setStatus(node.path("status").asText());
            taskIds.add(tasks.create(OWNER, draft, Task.SOURCE_MANUAL).getId());
        }
    }
}
