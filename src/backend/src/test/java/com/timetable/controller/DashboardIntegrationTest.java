package com.timetable.controller;

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
import org.springframework.test.web.servlet.ResultActions;

import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AI Dashboard 聚合端点（AI Campus Agent V1.0 Step 5）。
 *
 * 真实应用启动 + 真实鉴权 + 真实迁移；一次请求验证档案/今日课程/今日任务/
 * 48h 截止/考试倒计时/规则重点的聚合正确性与账号隔离。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:dashboard_endpoint;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class DashboardIntegrationTest {

    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 28); // 周一
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-dashboard-" + UUID.randomUUID()).toString();

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate sql;
    @MockBean LlmClient provider;

    @BeforeEach
    void clearDisposableAccounts() {
        for (String table : List.of("daily_plan", "task", "exam", "course", "schedule",
                "student_profile", "api_key")) {
            sql.update("DELETE FROM " + table);
        }
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void dashboardAggregatesProfileCoursesTasksAndRuleBasedHighlights() throws Exception {
        register(FIRST).andExpect(status().isOk());
        Long scheduleId = createSchedule(FIRST, "Dashboard schedule");
        seedCourse(scheduleId, "高等数学", 1, 1, 2);      // 周一 1-2 节（今天）
        seedCourse(scheduleId, "线性代数", 3, 3, 4);      // 周三（今天不出现）
        seedExam(scheduleId, "数据结构期末考试", "2026-10-05");
        seedTask(FIRST, "今天截止的任务", "2026-09-28 23:59");
        seedTask(FIRST, "已逾期的任务", "2026-09-20 23:59");
        seedTask(FIRST, "48 小时内截止", "2026-09-29 12:00");
        seedTask(FIRST, "窗口外任务", "2026-12-01 23:59");
        seedTask(FIRST, "无截止任务", null);
        sql.update("INSERT INTO student_profile(api_key,name,school,major,interest,skills) VALUES (?,?,?,?,?,?)",
                FIRST, "小明", "示例大学", "计算机科学与技术", "[]", "[]");

        mvc.perform(get("/api/dashboard").header("X-API-Key", FIRST)
                        .param("date", TODAY.toString()).param("scheduleId", scheduleId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.date").value("2026-09-28"))
                .andExpect(jsonPath("$.data.profilePresent").value(true))
                .andExpect(jsonPath("$.data.greetingName").value("小明"))
                .andExpect(jsonPath("$.data.profile.major").value("计算机科学与技术"))
                // 今日课程：只含周一的课
                .andExpect(jsonPath("$.data.todayCourses", hasSize(1)))
                .andExpect(jsonPath("$.data.todayCourses[0].name").value("高等数学"))
                // 今日任务：今天截止 + 已逾期 + 无截止；48h 单列；窗口外/已完成不出现
                .andExpect(jsonPath("$.data.todayTasks", hasSize(3)))
                .andExpect(jsonPath("$.data.upcomingDeadlines", hasSize(1)))
                .andExpect(jsonPath("$.data.upcomingDeadlines[0].title").value("48 小时内截止"))
                // 考试倒计时：14 天内
                .andExpect(jsonPath("$.data.upcomingExams", hasSize(1)))
                .andExpect(jsonPath("$.data.upcomingExams[0].name").value("数据结构期末考试"))
                // 规则重点：逾期/今天截止/48h/考试倒计时（确定性，不烧 token）
                .andExpect(jsonPath("$.data.todayHighlights", hasSize(4)))
                .andExpect(jsonPath("$.data.todayHighlights[0]").value("「已逾期的任务」已逾期 8 天"))
                .andExpect(jsonPath("$.data.todayHighlights[1]").value("「今天截止的任务」今天截止"))
                .andExpect(jsonPath("$.data.todayHighlights[2]").value("「48 小时内截止」将在 36 小时后截止"))
                .andExpect(jsonPath("$.data.todayHighlights[3]").value("「数据结构期末考试」还有 7 天考试"))
                // Step 6 占位：AI 每日计划摘要暂为 null
                .andExpect(jsonPath("$.data.planSummary").value(nullValue()));
    }

    @Test
    void dashboardCarriesCachedDailyPlanSummary() throws Exception {
        register(FIRST).andExpect(status().isOk());
        Long scheduleId = createSchedule(FIRST, "Plan dashboard schedule");
        // 模拟已生成的计划缓存（首页只读缓存，不触发生成）
        sql.update("INSERT INTO daily_plan(api_key,plan_date,content,summary) VALUES (?,?,?,?)",
                FIRST, java.sql.Date.valueOf(TODAY),
                "{\"items\":[{\"type\":\"COURSE\",\"title\":\"高等数学\",\"start\":\"08:00\",\"end\":\"09:35\","
                        + "\"refId\":7,\"note\":\"\"}]}",
                "先把上午的课上好");

        mvc.perform(get("/api/dashboard").header("X-API-Key", FIRST)
                        .param("date", TODAY.toString()).param("scheduleId", scheduleId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.planSummary").value("先把上午的课上好"))
                .andExpect(jsonPath("$.data.plan.cached").value(true))
                .andExpect(jsonPath("$.data.plan.items", hasSize(1)))
                .andExpect(jsonPath("$.data.plan.items[0].type").value("COURSE"));
    }

    @Test
    void dashboardForFreshAccountIsEmptyButFriendly() throws Exception {
        register(FIRST).andExpect(status().isOk());

        mvc.perform(get("/api/dashboard").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.profilePresent").value(false))
                .andExpect(jsonPath("$.data.greetingName").value(nullValue()))
                .andExpect(jsonPath("$.data.todayCourses", hasSize(0)))
                .andExpect(jsonPath("$.data.todayTasks", hasSize(0)))
                .andExpect(jsonPath("$.data.upcomingDeadlines", hasSize(0)))
                .andExpect(jsonPath("$.data.upcomingExams", hasSize(0)))
                .andExpect(jsonPath("$.data.todayHighlights", hasSize(0)));
    }

    @Test
    void dashboardRejectsForeignScheduleAndRequiresAuth() throws Exception {
        register(FIRST).andExpect(status().isOk());
        register(SECOND).andExpect(status().isOk());
        Long firstSchedule = createSchedule(FIRST, "First schedule");

        // 未登录 401
        mvc.perform(get("/api/dashboard")).andExpect(status().isUnauthorized());
        // 传入他人课表 404（不泄露他人数据）
        mvc.perform(get("/api/dashboard").header("X-API-Key", SECOND)
                        .param("scheduleId", firstSchedule.toString()))
                .andExpect(status().isNotFound());
        // 本人可见
        mvc.perform(get("/api/dashboard").header("X-API-Key", FIRST)
                        .param("scheduleId", firstSchedule.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.todayCourses", hasSize(0)));
    }

    // ==================== 辅助 ====================

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }

    private Long createSchedule(String key, String name) throws Exception {
        String response = mvc.perform(post("/api/schedules").header("X-API-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("name", name,
                                "periodStartDate", "2026-09-07", "periodEndDate", "2027-01-31"))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data").path("id").asLong();
    }

    private void seedCourse(Long scheduleId, String name, int dayOfWeek, int start, int end) {
        sql.update("INSERT INTO course(schedule_id,name,day_of_week,start_period,end_period,weeks) "
                + "VALUES (?,?,?,?,?,?)", scheduleId, name, dayOfWeek, start, end, "[1,2,3,4]");
    }

    private void seedExam(Long scheduleId, String name, String date) {
        sql.update("INSERT INTO exam(schedule_id,name,exam_date,start_time,end_time) "
                + "VALUES (?,?,?,?,?)", scheduleId, name, java.sql.Date.valueOf(date),
                java.sql.Time.valueOf("09:00:00"), java.sql.Time.valueOf("11:00:00"));
    }

    private void seedTask(String key, String title, String deadline) {
        if (deadline == null) {
            sql.update("INSERT INTO task(api_key,title,type,priority,status,source) VALUES (?,?,?,?,?,?)",
                    key, title, "OTHER", 2, "PENDING", "MANUAL");
        } else {
            sql.update("INSERT INTO task(api_key,title,type,priority,status,source,deadline) "
                    + "VALUES (?,?,?,?,?,?,?)", key, title, "OTHER", 2, "PENDING", "MANUAL",
                    java.sql.Timestamp.valueOf(LocalDateTime.parse(deadline.replace(" ", "T"))));
        }
    }
}
