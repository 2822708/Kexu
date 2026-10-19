package com.timetable.controller;

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

import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 凭据不得出现在任何接口响应里。
 *
 * <p>为什么单独写一个测试：{@code apiKey} 是实体的普通字段，MyBatis 查出来会带上，
 * 只要漏一个 {@code @JsonIgnore}，它就会跟着整个对象序列化出去。而这种泄露
 * <b>不会导致任何功能异常</b>——页面上根本看不到它，只有打开 DevTools 的人才发现。
 * 所以它极容易在「新加一个实体」时悄悄回归，靠人 review 是守不住的。
 *
 * <p>本测试遍历所有会返回实体的接口，逐个断言响应体里不含当前用户的 Key。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:credential_leak;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class CredentialLeakTest {

    /** 用带特征的前缀，保证在响应里出现时一定能被抓到。 */
    private static final String KEY = "device_" + "z".repeat(43);
    private static final Path TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-leak-" + UUID.randomUUID());

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR.toString());
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate sql;
    @MockBean LlmClient provider;

    @BeforeEach
    void seedEverything() throws Exception {
        for (String table : new String[]{"ai_event", "task", "schedule", "daily_plan",
                "student_memory", "student_profile", "api_key"}) {
            sql.update("DELETE FROM " + table);
        }
        mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content("{\"deviceKey\":\"" + KEY + "\"}")).andExpect(status().isOk());

        sql.update("INSERT INTO schedule(api_key,name,period_start_date,period_end_date) VALUES (?,?,?,?)",
                KEY, "学期", java.sql.Date.valueOf(LocalDate.now().minusDays(30)),
                java.sql.Date.valueOf(LocalDate.now().plusDays(30)));
        Long scheduleId = sql.queryForObject("SELECT MAX(id) FROM schedule", Long.class);

        sql.update("INSERT INTO task(api_key,title,type,priority,status,schedule_id,created_at,updated_at) "
                        + "VALUES (?,?,?,?,?,?,?,?)",
                KEY, "任务", "OTHER", 2, "PENDING", scheduleId,
                Timestamp.valueOf(LocalDateTime.now()), Timestamp.valueOf(LocalDateTime.now()));

        // interest / skills 是 NOT NULL 且无默认值，必须显式给
        sql.update("INSERT INTO student_profile(api_key,name,school,interest,skills) VALUES (?,?,?,?,?)",
                KEY, "小明", "某大学", "算法", "Java");

        sql.update("INSERT INTO student_memory(api_key,type,content) VALUES (?,?,?)", KEY, "GOAL", "准备考研");

        sql.update("INSERT INTO daily_plan(api_key,plan_date,content,summary,created_at) VALUES (?,?,?,?,?)",
                KEY, java.sql.Date.valueOf(LocalDate.now()), "{\"items\":[]}", "小结",
                Timestamp.valueOf(LocalDateTime.now()));

        sql.update("INSERT INTO ai_event(api_key,event_type,created_at) VALUES (?,?,?)",
                KEY, "APP_ACTIVE", Timestamp.valueOf(LocalDateTime.now()));
    }

    @Test
    void taskEndpointsDoNotEchoApiKey() throws Exception {
        assertNoKey(get("/api/tasks").header("X-API-Key", KEY));
        assertNoKey(get("/api/tasks/page").header("X-API-Key", KEY));
    }

    @Test
    void profileAndMemoryEndpointsDoNotEchoApiKey() throws Exception {
        assertNoKey(get("/api/profile").header("X-API-Key", KEY));
        assertNoKey(get("/api/memories").header("X-API-Key", KEY));
    }

    @Test
    void planEndpointDoesNotEchoApiKey() throws Exception {
        assertNoKey(get("/api/plans/daily").header("X-API-Key", KEY));
    }

    @Test
    void statsEndpointsDoNotEchoApiKey() throws Exception {
        assertNoKey(get("/api/stats/usage").header("X-API-Key", KEY));
        assertNoKey(get("/api/stats/proposals").header("X-API-Key", KEY));
        assertNoKey(get("/api/stats/health").header("X-API-Key", KEY));
    }

    @Test
    void scheduleEndpointDoesNotEchoApiKey() throws Exception {
        assertNoKey(get("/api/schedules").header("X-API-Key", KEY));
    }

    private void assertNoKey(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        String body = mvc.perform(request).andReturn().getResponse().getContentAsString();
        assertThat(body)
                .as("响应体泄露了 API Key。检查对应实体的 apiKey 字段是否漏了 @JsonIgnore")
                .doesNotContain(KEY)
                .doesNotContain("apiKey");
    }
}
