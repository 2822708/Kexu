package com.timetable.controller;

import com.timetable.TimetableApplication;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 计划采纳率与留存（成本治理 6.1 #1）。
 *
 * <p>这个指标最大的风险不是算错，而是<b>算得看起来对但口径是错的</b>——
 * 那种错误没人会发现，然后拿着假数据做决策。所以每个用例都锁定一条口径：
 *
 * <ol>
 *   <li>任务被推进 → 算采用；</li>
 *   <li>计划里没任务（那天没待办）→ <b>不算</b>采用，也不该进分母；</li>
 *   <li>任务没动 → 不算采用；</li>
 *   <li>当天还没过完 → 进 pending，<b>不进</b>分母；</li>
 *   <li>别人的计划不串味（api_key 隔离）。</li>
 * </ol>
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:product_health;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class ProductHealthEndpointTest {

    private static final String ME = "device_" + "h".repeat(43);
    private static final String OTHER = "device_" + "i".repeat(43);
    private static final Path TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-health-" + UUID.randomUUID());

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR.toString());
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate sql;
    @MockBean LlmClient provider;

    @BeforeEach
    void clean() throws Exception {
        for (String table : new String[]{"ai_event", "ai_action", "daily_plan", "task", "api_key"}) {
            sql.update("DELETE FROM " + table);
        }
        register(ME);
        register(OTHER);
    }

    @Test
    void requiresAuth() throws Exception {
        mvc.perform(get("/api/stats/health")).andExpect(status().isUnauthorized());
    }

    @Test
    void finishedDayCountsAsAdoptedWhenAPlannedTaskMoved() throws Exception {
        // 昨天的计划，安排了两个任务，其中一个昨天被做完了
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long doneTask = seedTask(ME, "写实验报告", "DONE", yesterday.atTime(15, 0));
        Long openTask = seedTask(ME, "看网课", "PENDING", yesterday.atTime(9, 0));
        Long planId = seedPlan(ME, yesterday, yesterday.atTime(8, 0), doneTask, openTask);
        seedEvent(ME, "PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generatedCount").value(1))
                .andExpect(jsonPath("$.data.adoptedCount").value(1))
                .andExpect(jsonPath("$.data.pendingCount").value(0))
                .andExpect(jsonPath("$.data.adoptionRate").value(100.0));
    }

    @Test
    void untouchedTaskIsNotAdopted() throws Exception {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        // 任务是 PENDING，且 updated_at 停在生成之前 → 昨天没照着计划做
        Long task = seedTask(ME, "写实验报告", "PENDING", yesterday.atTime(7, 0));
        Long planId = seedPlan(ME, yesterday, yesterday.atTime(8, 0), task);
        seedEvent(ME, "PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.generatedCount").value(1))
                .andExpect(jsonPath("$.data.adoptedCount").value(0))
                .andExpect(jsonPath("$.data.adoptionRate").value(0.0));
    }

    @Test
    void todayPlanIsPendingNotAdopted() throws Exception {
        // 今天生成的计划，今天还没过完 → 未定，不进分母
        LocalDateTime now = LocalDateTime.now();
        Long task = seedTask(ME, "写实验报告", "PENDING", now.minusHours(1));
        Long planId = seedPlan(ME, LocalDate.now(), now, task);
        seedEvent(ME, "PLAN_GENERATED", planId, now);

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.generatedCount").value(1))
                .andExpect(jsonPath("$.data.adoptedCount").value(0))
                .andExpect(jsonPath("$.data.pendingCount").value(1))
                // 分母被扣掉之后剩 0，比率为 null 而不是 0%——后者会被读成「全都没用」
                .andExpect(jsonPath("$.data.adoptionRate").doesNotExist());
    }

    @Test
    void planWithoutTasksIsNotAdopted() throws Exception {
        // 那天一份纯课程/休息的计划：没有可对账的任务，不该算「采用了」
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long planId = seedPlanContent(ME, yesterday, yesterday.atTime(8, 0),
                "{\"items\":[{\"start\":\"08:00\",\"end\":\"09:00\",\"type\":\"COURSE\",\"title\":\"高数\"}]}");
        seedEvent(ME, "PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.generatedCount").value(1))
                .andExpect(jsonPath("$.data.adoptedCount").value(0));
    }

    @Test
    void adoptionIsScopedToOwner() throws Exception {
        // OTHER 的计划与任务都不该出现在 ME 的统计里
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long otherTask = seedTask(OTHER, "他的任务", "DONE", yesterday.atTime(15, 0));
        Long otherPlan = seedPlan(OTHER, yesterday, yesterday.atTime(8, 0), otherTask);
        seedEvent(OTHER, "PLAN_GENERATED", otherPlan, yesterday.atTime(8, 0));

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.generatedCount").value(0))
                .andExpect(jsonPath("$.data.adoptedCount").value(0));
    }

    @Test
    void repeatedCallsDoNotDoubleCountAdoption() throws Exception {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long task = seedTask(ME, "写实验报告", "DONE", yesterday.atTime(15, 0));
        Long planId = seedPlan(ME, yesterday, yesterday.atTime(8, 0), task);
        seedEvent(ME, "PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        // 连刷三次：每次 settleRecent 都可能重新判一次，但只能落一条 ADOPTED
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/stats/health").header("X-API-Key", ME)).andExpect(status().isOk());
        }
        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.adoptedCount").value(1))
                .andExpect(jsonPath("$.data.adoptionRate").value(100.0));
    }

    @Test
    void retentionNeedsTwoDistinctActiveDays() throws Exception {
        // ME 昨天和前天都活跃 → 留存；OTHER 只有一天 → 不算留存
        LocalDate today = LocalDate.now();
        seedEvent(ME, "APP_ACTIVE", null, today.minusDays(1).atTime(10, 0));
        seedEvent(ME, "APP_ACTIVE", null, today.minusDays(2).atTime(11, 0));
        seedEvent(OTHER, "APP_ACTIVE", null, today.minusDays(1).atTime(12, 0));

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.windowDays").value(7))
                .andExpect(jsonPath("$.data.activeUserCount").value(2))
                .andExpect(jsonPath("$.data.retainedUserCount").value(1))
                .andExpect(jsonPath("$.data.retentionRate").value(50.0));
    }

    @Test
    void sameDayRepeatedActiveEventsCountAsOneDay() throws Exception {
        LocalDate today = LocalDate.now();
        // 同一天三条，只算 1 天 → 不构成留存
        for (int hour = 9; hour <= 11; hour++) {
            seedEvent(ME, "APP_ACTIVE", null, today.minusDays(1).atTime(hour, 0));
        }

        mvc.perform(get("/api/stats/health").header("X-API-Key", ME))
                .andExpect(jsonPath("$.data.activeUserCount").value(1))
                .andExpect(jsonPath("$.data.retainedUserCount").value(0))
                .andExpect(jsonPath("$.data.retentionRate").value(0.0));
    }

    // ==================== 造数 ====================

    private void register(String apiKey) throws Exception {
        mvc.perform(post("/api/auth/device")
                        .contentType("application/json")
                        .content("{\"deviceKey\":\"" + apiKey + "\"}"))
                .andExpect(status().isOk());
    }

    private Long seedTask(String apiKey, String title, String status, LocalDateTime updatedAt) {
        sql.update("INSERT INTO task(api_key,title,type,priority,status,created_at,updated_at) "
                        + "VALUES (?,?,?,?,?,?,?)",
                apiKey, title, "OTHER", 2, status,
                Timestamp.valueOf(updatedAt.minusDays(1)), Timestamp.valueOf(updatedAt));
        return sql.queryForObject("SELECT MAX(id) FROM task WHERE api_key = ?", Long.class, apiKey);
    }

    private Long seedPlan(String apiKey, LocalDate planDate, LocalDateTime createdAt, Long... taskIds) {
        StringBuilder items = new StringBuilder("{\"items\":[");
        for (int i = 0; i < taskIds.length; i++) {
            if (i > 0) {
                items.append(',');
            }
            items.append("{\"start\":\"09:00\",\"end\":\"10:00\",\"type\":\"TASK\",\"title\":\"t\",\"refId\":")
                    .append(taskIds[i]).append('}');
        }
        items.append("]}");
        return seedPlanContent(apiKey, planDate, createdAt, items.toString());
    }

    private Long seedPlanContent(String apiKey, LocalDate planDate, LocalDateTime createdAt, String content) {
        sql.update("INSERT INTO daily_plan(api_key,plan_date,content,summary,created_at) VALUES (?,?,?,?,?)",
                apiKey, java.sql.Date.valueOf(planDate), content, "小结", Timestamp.valueOf(createdAt));
        return sql.queryForObject("SELECT MAX(id) FROM daily_plan WHERE api_key = ?", Long.class, apiKey);
    }

    private void seedEvent(String apiKey, String type, Long refId, LocalDateTime at) {
        sql.update("INSERT INTO ai_event(api_key,event_type,scene,action_type,ref_id,created_at) "
                        + "VALUES (?,?,?,?,?,?)",
                apiKey, type, null, null, refId, Timestamp.valueOf(at));
    }
}
