package com.timetable.service;

import com.timetable.entity.AiEvent;
import com.timetable.mapper.AiEventMapper;
import com.timetable.mapper.DailyPlanMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 采纳判定服务本身的边界（成本治理 6.1 #1）。
 *
 * <p>为什么单独测这个类而不只测接口：接口层有个「减去 pending」的补偿逻辑，
 * 会<b>掩盖</b>判定层自己对 pending 处理不当的问题——比率看起来对，
 * 但事件表里已经写了错的 {@code PLAN_ADOPTED} 记录。以后任何直接读事件的分析
 * （报表、导出、复盘）都会拿到假数据。这类错误在接口测试里是完全隐形的。
 */
@SpringBootTest(classes = com.timetable.TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:adoption_service;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class DailyPlanAdoptionServiceTest {

    private static final String ME = "device_" + "j".repeat(43);
    private static final Path TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-adoption-svc-" + UUID.randomUUID());

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR.toString());
    }

    @Autowired DailyPlanAdoptionService service;
    @Autowired JdbcTemplate sql;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockBean com.timetable.service.LlmClient provider;

    @BeforeEach
    void clean() throws Exception {
        for (String table : new String[]{"ai_event", "daily_plan", "task", "api_key"}) {
            sql.update("DELETE FROM " + table);
        }
        mvc.perform(post("/api/auth/device").contentType("application/json")
                .content("{\"deviceKey\":\"" + ME + "\"}")).andExpect(status().isOk());
    }

    @Test
    void doesNotWriteAdoptedForTodayUnfinishedPlan() {
        LocalDateTime now = LocalDateTime.now();
        Long task = seedTask("DONE", now.minusMinutes(30));
        Long planId = seedPlan(LocalDate.now(), now.minusHours(2), task);
        seedEvent("PLAN_GENERATED", planId, now.minusHours(2));

        int adopted = service.settleRecent(ME);

        // 今天还没过完，就算任务此刻是 DONE 也不能下结论——
        // 用户可能只是顺手把别的任务标完了，和这份计划无关。
        assertThat(adopted).isZero();
        assertThat(countEvents("PLAN_ADOPTED")).isZero();
    }

    @Test
    void writesExactlyOneAdoptedEventAcrossRepeatedSettles() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long task = seedTask("DONE", yesterday.atTime(15, 0));
        Long planId = seedPlan(yesterday, yesterday.atTime(8, 0), task);
        seedEvent("PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        assertThat(service.settleRecent(ME)).isEqualTo(1);
        assertThat(service.settleRecent(ME)).isZero();
        assertThat(service.settleRecent(ME)).isZero();

        assertThat(countEvents("PLAN_ADOPTED")).isEqualTo(1);
    }

    @Test
    void ignoresTaskUpdatedBeforePlanWasGenerated() {
        // 任务在计划生成之前就已经 DONE：那是历史，不能算这份计划的功劳
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long task = seedTask("DONE", yesterday.atTime(7, 0));
        Long planId = seedPlan(yesterday, yesterday.atTime(8, 0), task);
        seedEvent("PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        assertThat(service.settleRecent(ME)).isZero();
    }

    @Test
    void ignoresTaskUpdatedAfterTheDayEnded() {
        // 计划是昨天的，任务拖到今天晚上才做——不算「照着昨天的计划做了」
        LocalDate yesterday = LocalDate.now().minusDays(1);
        Long task = seedTask("DONE", LocalDate.now().atTime(1, 0));
        Long planId = seedPlan(yesterday, yesterday.atTime(8, 0), task);
        seedEvent("PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        assertThat(service.settleRecent(ME)).isZero();
    }

    @Test
    void malformedContentDoesNotThrow() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        sql.update("INSERT INTO daily_plan(api_key,plan_date,content,summary,created_at) VALUES (?,?,?,?,?)",
                ME, Date.valueOf(yesterday), "{这不是 JSON", "x",
                Timestamp.valueOf(yesterday.atTime(8, 0)));
        Long planId = sql.queryForObject("SELECT MAX(id) FROM daily_plan WHERE api_key=?", Long.class, ME);
        seedEvent("PLAN_GENERATED", planId, yesterday.atTime(8, 0));

        // 坏数据不能让统计接口崩，只能是「判未采用」
        assertThat(service.settleRecent(ME)).isZero();
    }

    private long countEvents(String type) {
        Long n = sql.queryForObject("SELECT COUNT(*) FROM ai_event WHERE api_key=? AND event_type=?",
                Long.class, ME, type);
        return n == null ? 0 : n;
    }

    private Long seedTask(String status, LocalDateTime updatedAt) {
        sql.update("INSERT INTO task(api_key,title,type,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                ME, "任务", "OTHER", 2, status,
                Timestamp.valueOf(updatedAt.minusDays(2)), Timestamp.valueOf(updatedAt));
        return sql.queryForObject("SELECT MAX(id) FROM task WHERE api_key=?", Long.class, ME);
    }

    private Long seedPlan(LocalDate date, LocalDateTime createdAt, Long taskId) {
        String content = "{\"items\":[{\"start\":\"09:00\",\"end\":\"10:00\",\"type\":\"TASK\","
                + "\"title\":\"t\",\"refId\":" + taskId + "}]}";
        sql.update("INSERT INTO daily_plan(api_key,plan_date,content,summary,created_at) VALUES (?,?,?,?,?)",
                ME, Date.valueOf(date), content, "小结", Timestamp.valueOf(createdAt));
        return sql.queryForObject("SELECT MAX(id) FROM daily_plan WHERE api_key=?", Long.class, ME);
    }

    private void seedEvent(String type, Long refId, LocalDateTime at) {
        sql.update("INSERT INTO ai_event(api_key,event_type,ref_id,created_at) VALUES (?,?,?,?)",
                ME, type, refId, Timestamp.valueOf(at));
    }
}
