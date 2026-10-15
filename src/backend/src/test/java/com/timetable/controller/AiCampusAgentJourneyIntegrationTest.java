package com.timetable.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.TimetableApplication;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * V1.0 端到端验收旅程（AI Campus Agent）。
 *
 * 真实应用启动 + 真实鉴权 + 真实迁移 + 真实 HTTP，只 mock 外部 LLM。
 * 一条链路串起方案 §2.11 的可演示旅程：建档 → 课表 → AI 提案（确认后才落库）
 * → 材料解析成任务 → 首页聚合 → 记忆累积（同一事实只留一条）→ 每日计划。
 *
 * 最后用 ai_action 表做审计：任何 AI 写入都必须有一条已确认的 action 记录，
 * 即「human-in-the-loop」不是口号而是可查证的。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_journey;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class AiCampusAgentJourneyIntegrationTest {

    private static final String KEY = "device_" + "j".repeat(43);
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-journey-" + UUID.randomUUID()).toString();

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate sql;
    @MockBean LlmClient provider;

    private final LocalDate today = LocalDate.now();

    @BeforeEach
    void clearDisposableAccounts() {
        for (String table : List.of("daily_plan", "task", "exam", "course", "schedule",
                "student_profile", "student_memory", "ai_action", "ai_message", "ai_conversation", "api_key")) {
            sql.update("DELETE FROM " + table);
        }
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void fullJourneyFromProfileToPlanNeverWritesWithoutConfirmation() throws Exception {
        register().andExpect(status().isOk());

        // ============ 1. 建档：首页「你好，{name}」============
        mvc.perform(put("/api/profile").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "name", "小明", "school", "示例大学",
                                "major", "计算机科学与技术", "grade", "大二",
                                "goal", "通过 12 月 CET-6", "learningStyle", "晚上效率高",
                                "interest", List.of("机器学习"), "skills", List.of("Java")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("小明"))
                .andExpect(jsonPath("$.data.updatedBy").value("USER"));

        // ============ 2. 课表：今日课程 + 14 天内考试 + 48h 截止任务 ============
        Long scheduleId = createSchedule();
        seedCourse(scheduleId, "高等数学", 1, 2);                    // 今天第 1-2 节
        seedExam(scheduleId, "数据结构期末考试", today.plusDays(7));
        Long manualTaskId = seedTask("48 小时内截止的实验报告", today.plusDays(1).atTime(12, 0));

        // ============ 3. AI 对话：产出提案但一个字都不写库 ============
        Long conversationId = createConversation(scheduleId);
        String proposedDeadline = today.plusDays(3).atTime(23, 59).toString().replace('T', ' ');

        when(provider.chatJson(any())).thenReturn(
                // 3.1 主回复：带一条 CREATE_TASK 提案
                """
                {"text":"这周有两件事要盯：高数作业和实验报告。","actions":[
                  {"type":"CREATE_TASK","data":{"tasks":[{"title":"完成高数第三章作业","type":"COURSE_WORK",
                   "priority":1,"deadline":"%s","description":"教材 P58"}]}}]}
                """.formatted(proposedDeadline),
                // 3.2 记忆提炼：这轮没有跨天事实
                "{\"memories\":[],\"profile\":{}}",
                // 4. 材料解析：从作业通知里抽出草稿
                """
                {"tasks":[{"title":"提交数据结构实验报告","type":"LAB_REPORT","priority":1,
                  "deadline":"%s","confidence":0.92,"evidence":"实验三报告请于周五前提交"}]}
                """.formatted(proposedDeadline),
                // 6.1 第二轮主回复（纯文本）
                "{\"text\":\"收到，六级我记住了。\",\"actions\":[]}",
                // 6.2 提炼：产出一条 GOAL 记忆
                """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试","importance":5}],"profile":{}}
                """,
                // 6.3 第三轮主回复
                "{\"text\":\"还在按六级准备。\",\"actions\":[]}",
                // 6.4 提炼：同一件事又提了一次（标点不同），服务端必须合并而不是新增
                """
                {"memories":[{"type":"GOAL","content":"准备12月CET-6考试！","importance":5}],"profile":{}}
                """,
                // 7. 每日计划
                planJson(scheduleId, manualTaskId));

        JsonNode chat = sendMessage(conversationId, "这周有什么任务");
        JsonNode taskProposal = findAction(chat, "CREATE_TASK");
        assertThat(taskProposal.get("status").asText()).isEqualTo("PENDING");
        // human-in-the-loop：提案阶段任务数为 0
        assertThat(taskCount()).isEqualTo(1);
        assertThat(taskTitles()).doesNotContain("完成高数第三章作业");

        // 确认 AI 提案：任务才真正落库。
        // 顺序很关键：提案执行前不要动任务数据——TASK 域指纹变了提案会判 STALE，
        // 这是刻意的设计（用户改过数据后旧提案不该再执行），不是缺陷。
        executeAction(conversationId, taskProposal.get("actionId").asLong());
        assertThat(taskTitles()).contains("完成高数第三章作业");
        assertThat(sql.queryForObject(
                "SELECT COUNT(*) FROM ai_action WHERE action_status='EXECUTED'", Integer.class)).isEqualTo(1);

        // ============ 4. 材料解析 → 草稿（不落库）→ 确认后批量落库 ============
        String extractBody = mvc.perform(post("/api/tasks/extract").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("text",
                                "通知：实验三报告请于周五前提交至教务系统。"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tasks", hasSize(1)))
                .andExpect(jsonPath("$.data.tasks[0].title").value("提交数据结构实验报告"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(taskCount()).as("抽取只出草稿，不落库").isEqualTo(2);

        JsonNode draft = json.readTree(extractBody).path("data").path("tasks").get(0);
        mvc.perform(post("/api/tasks").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("tasks", List.of(Map.of(
                                "title", draft.path("title").asText(),
                                "type", draft.path("type").asText(),
                                "priority", draft.path("priority").asInt(),
                                "deadline", draft.path("deadline").asText()))))))
                .andExpect(status().isOk());
        assertThat(taskTitles()).contains("提交数据结构实验报告");

        // ============ 5. 首页聚合：今日课程 / 今日重点 / 考试倒计时 ============
        mvc.perform(get("/api/dashboard").header("X-API-Key", KEY)
                        .param("date", today.toString()).param("scheduleId", scheduleId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.greetingName").value("小明"))
                .andExpect(jsonPath("$.data.profilePresent").value(true))
                .andExpect(jsonPath("$.data.profile.major").value("计算机科学与技术"))
                .andExpect(jsonPath("$.data.todayCourses", hasSize(1)))
                .andExpect(jsonPath("$.data.todayCourses[0].name").value("高等数学"))
                .andExpect(jsonPath("$.data.todayHighlights", hasSize(org.hamcrest.Matchers.greaterThanOrEqualTo(2))))
                .andExpect(jsonPath("$.data.upcomingExams", hasSize(1)));

        // ============ 6. 记忆：两轮对话后仍只有一条 ============
        JsonNode second = sendMessage(conversationId, "我报了 12 月的六级，以后多提醒我");
        JsonNode memoryProposal = findAction(second, "SAVE_MEMORY");
        assertThat(memoryProposal.get("status").asText()).isEqualTo("PENDING");
        executeAction(conversationId, memoryProposal.get("actionId").asLong());
        mvc.perform(get("/api/memories").header("X-API-Key", KEY))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].content").value("准备 12 月 CET-6 考试"));

        JsonNode third = sendMessage(conversationId, "还是在准备六级");
        JsonNode again = findAction(third, "SAVE_MEMORY");
        executeAction(conversationId, again.get("actionId").asLong());
        mvc.perform(get("/api/memories").header("X-API-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].importance").value(5));

        // 新对话里档案与记忆都会进入上下文（记忆被真正用起来，不是只存不看）
        mvc.perform(get("/api/ai/conversations/" + conversationId + "/context")
                        .header("X-API-Key", KEY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.profilePresent").value(true))
                .andExpect(jsonPath("$.data.memoryCount").value(1));

        // ============ 7. 每日计划：真实课程块 + 未完成任务块 + 休息 ============
        mvc.perform(post("/api/plans/daily").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("scheduleId", scheduleId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cached").value(false))
                .andExpect(jsonPath("$.data.items", hasSize(3)));
        // 第二次命中缓存，不再烧 token
        mvc.perform(post("/api/plans/daily").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("scheduleId", scheduleId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cached").value(true));

        // ============ 8. 审计：没有未经确认的 AI 写入 ============
        Integer pending = sql.queryForObject(
                "SELECT COUNT(*) FROM ai_action WHERE action_status='PENDING'", Integer.class);
        Integer executed = sql.queryForObject(
                "SELECT COUNT(*) FROM ai_action WHERE action_status='EXECUTED'", Integer.class);
        assertThat(executed).isEqualTo(3);   // CREATE_TASK + 2 次 SAVE_MEMORY
        assertThat(pending).as("旅程结束后不应残留待确认提案").isZero();
        // 任务总数 = 1 手动 + 1 材料解析（用户确认后）+ 1 AI 提案（用户确认后）
        assertThat(taskCount()).isEqualTo(3);
    }

    @Test
    void profileIsAccountScopedAndClearsFieldsOnEmptySubmit() throws Exception {
        register().andExpect(status().isOk());
        String other = "device_" + "k".repeat(43);
        mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", other)))).andExpect(status().isOk());

        mvc.perform(put("/api/profile").header("X-API-Key", KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("name", "小明", "major", "计算机"))))
                .andExpect(status().isOk());
        // 他人看不到
        mvc.perform(get("/api/profile").header("X-API-Key", other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist());
        // 未带 key 401
        mvc.perform(get("/api/profile")).andExpect(status().isUnauthorized());
        // 表单清空字段 = 真删除（与 AI 提案「null=保持原值」的补丁语义相反）
        mvc.perform(put("/api/profile").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("name", "小明", "major", ""))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.major").doesNotExist());
        // 越权字段一律拒绝
        mvc.perform(put("/api/profile").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("apiKey", "someone-else"))))
                .andExpect(status().isBadRequest());
    }

    // ==================== 辅助 ====================

    /** 计划 JSON：课程块用真实课程 id 与作息表换算时刻，任务块用未完成任务 id。 */
    private String planJson(Long scheduleId, Long taskId) {
        Long courseId = sql.queryForObject(
                "SELECT id FROM course WHERE schedule_id=?", Long.class, scheduleId);
        String start = sql.queryForObject(
                "SELECT start_time FROM period_config WHERE period_number=1", String.class);
        String end = sql.queryForObject(
                "SELECT end_time FROM period_config WHERE period_number=2", String.class);
        return """
                {"date":"%s","items":[
                  {"start":"%s","end":"%s","type":"COURSE","title":"高等数学","ref_id":%d,"note":"带教材"},
                  {"start":"14:00","end":"15:00","type":"TASK","title":"推进实验报告","ref_id":%d,"note":"先写结论"},
                  {"start":"12:00","end":"13:00","type":"BREAK","title":"午休","ref_id":null,"note":""}
                ],"summary":"上午上课，下午推进报告"}
                """.formatted(today, hhmm(start), hhmm(end), courseId, taskId);
    }

    private static String hhmm(String time) {
        return time.length() >= 5 ? time.substring(0, 5) : time;
    }

    private org.springframework.test.web.servlet.ResultActions register() throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", KEY))));
    }

    private Long createSchedule() throws Exception {
        String response = mvc.perform(post("/api/schedules").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("name", "Journey schedule",
                                "periodStartDate", today.minusDays(30).toString(),
                                "periodEndDate", today.plusDays(120).toString()))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(response).path("data").path("id").asLong();
    }

    private Long createConversation(Long scheduleId) throws Exception {
        String response = mvc.perform(post("/api/ai/conversations").header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("scheduleId", scheduleId))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(response).path("data").path("id").asLong();
    }

    private JsonNode sendMessage(Long conversationId, String content) throws Exception {
        String response = mvc.perform(post("/api/ai/conversations/" + conversationId + "/messages")
                        .header("X-API-Key", KEY)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("content", content))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(response).path("data");
    }

    /** 在一条消息的提案列表里找指定类型的提案。 */
    private JsonNode findAction(JsonNode message, String type) {
        for (JsonNode action : message.path("actions")) {
            if (type.equals(action.path("type").asText())) {
                return action;
            }
        }
        throw new AssertionError("消息里没有 " + type + " 提案：" + message);
    }

    private void executeAction(Long conversationId, Long actionId) throws Exception {
        mvc.perform(post("/api/ai/conversations/" + conversationId + "/actions/" + actionId + "/execute")
                .header("X-API-Key", KEY)).andExpect(status().isOk());
    }

    private void seedCourse(Long scheduleId, String name, int start, int end) {
        sql.update("INSERT INTO course(schedule_id,name,day_of_week,start_period,end_period,weeks) "
                        + "VALUES (?,?,?,?,?,?)",
                scheduleId, name, today.getDayOfWeek().getValue(), start, end,
                "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
    }

    private void seedExam(Long scheduleId, String name, LocalDate date) {
        sql.update("INSERT INTO exam(schedule_id,name,exam_date,start_time,end_time) "
                        + "VALUES (?,?,?,?,?)", scheduleId, name, java.sql.Date.valueOf(date),
                java.sql.Time.valueOf("09:00:00"), java.sql.Time.valueOf("11:00:00"));
    }

    private Long seedTask(String title, java.time.LocalDateTime deadline) {
        sql.update("INSERT INTO task(api_key,title,type,priority,status,source,deadline) "
                        + "VALUES (?,?,?,?,?,?,?)",
                KEY, title, "LAB_REPORT", 1, "PENDING", "MANUAL",
                java.sql.Timestamp.valueOf(deadline));
        return sql.queryForObject("SELECT id FROM task WHERE api_key=? AND title=?", Long.class, KEY, title);
    }

    private int taskCount() {
        return sql.queryForObject("SELECT COUNT(*) FROM task WHERE api_key=?", Integer.class, KEY);
    }

    private List<String> taskTitles() {
        return sql.queryForList("SELECT title FROM task WHERE api_key=?", String.class, KEY);
    }
}
