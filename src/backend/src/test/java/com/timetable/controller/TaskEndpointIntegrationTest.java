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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AI Campus Agent V1.0 Step 4：/api/tasks/extract 与 /api/tasks 的 HTTP 层验证。
 *
 * 真实应用启动 + 真实鉴权拦截器 + 真实 Flyway 迁移，只 mock 外部 LLM。
 * 覆盖：未登录 401、草稿抽取、草稿确认落库（source=AI_PARSE）、参数校验 400、账号归属隔离。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:task_endpoint;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class TaskEndpointIntegrationTest {

    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-task-endpoint-" + UUID.randomUUID()).toString();

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
        sql.update("DELETE FROM task");
        sql.update("DELETE FROM schedule");
        sql.update("DELETE FROM api_key");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void extractEndpointRequiresAuthentication() throws Exception {
        mvc.perform(post("/api/tasks/extract").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"第三次作业 10 月 15 日截止\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tasks\":[]}").header("X-API-Key", FIRST))
                .andExpect(status().isUnauthorized());
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task", Integer.class)).isZero();
    }

    @Test
    void extractThenConfirmCreatesTasksWithAiParseSource() throws Exception {
        register(FIRST).andExpect(status().isOk());
        // 服务端会把「过去的截止时间」清洗成 null（AiServiceImpl.parseExtractedDeadline 兜底），
        // 所以这里必须用相对今天的未来日期：本测试原先写死 2026-10-15，2026-10-16 日期一翻篇就失败。
        // 本类是 @SpringBootTest 真实系统时钟（TimeConfig: Clock.system(Asia/Shanghai)），没有固定 Clock。
        String futureDate = LocalDate.now().plusDays(7).toString();
        String expectedDeadline = futureDate + "T23:59:00";
        when(provider.chatJson(any(), any())).thenReturn("""
                {"tasks":[
                  {"title":"提交高等数学第三次作业","type":"COURSE_WORK","deadline":"%s 23:59","priority":1,"description":"提交到学习通"},
                  {"title":"完成 MOOC 第二章测试","type":"ONLINE_COURSE","deadline":null,"priority":2,"description":""}
                ],"confidence":0.88}""".formatted(futureDate));

        // 1) 抽取：只产草稿，不落库
        String extractBody = mvc.perform(post("/api/tasks/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"高等数学第三次作业 %s 23:59 截止；MOOC 第二章测试尽快完成\"}".formatted(futureDate)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.tasks", hasSize(2)))
                .andExpect(jsonPath("$.data.tasks[0].title").value("提交高等数学第三次作业"))
                .andExpect(jsonPath("$.data.tasks[0].deadline").value(expectedDeadline))
                .andExpect(jsonPath("$.data.tasks[1].deadline").value(nullValue()))
                .andExpect(jsonPath("$.data.confidence").value(0.88))
                .andReturn().getResponse().getContentAsString();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task", Integer.class)).isZero();

        // 2) 确认：用户核对后批量创建（模拟前端提交草稿，deadline 为 null 的条目如实带上）
        String drafts = json.readTree(extractBody).path("data").path("tasks").toString();
        mvc.perform(post("/api/tasks").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("tasks", json.readTree(drafts)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data", hasSize(2)))
                .andExpect(jsonPath("$.data[0].source").value("AI_PARSE"))
                .andExpect(jsonPath("$.data[0].status").value("PENDING"));

        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task WHERE api_key=?", Integer.class, FIRST)).isEqualTo(2);
        assertThat(sql.queryForObject(
                "SELECT COUNT(*) FROM task WHERE api_key=? AND source='AI_PARSE' AND deadline IS NULL",
                Integer.class, FIRST)).isEqualTo(1);
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task WHERE api_key=?", Integer.class, SECOND)).isZero();
    }

    @Test
    void createEndpointRejectsEmptyOrOversizedBatches() throws Exception {
        register(FIRST).andExpect(status().isOk());

        mvc.perform(post("/api/tasks").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"tasks\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));

        StringBuilder many = new StringBuilder("{\"tasks\":[");
        for (int i = 0; i < 21; i++) {
            if (i > 0) many.append(',');
            many.append("{\"title\":\"任务").append(i).append("\"}");
        }
        many.append("]}");
        mvc.perform(post("/api/tasks").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content(many.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task", Integer.class)).isZero();
    }

    @Test
    void extractEndpointRejectsEmptyBodyAndUnsupportedImage() throws Exception {
        register(FIRST).andExpect(status().isOk());

        mvc.perform(post("/api/tasks/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));

        mvc.perform(post("/api/tasks/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"imageDataUrl\":\"data:image/png;base64,###\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void taskCrudOverHttpWithOwnershipIsolation() throws Exception {
        register(FIRST).andExpect(status().isOk());
        register(SECOND).andExpect(status().isOk());

        // 创建（AI 草稿确认同路径）
        String created = mvc.perform(post("/api/tasks").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tasks":[{"title":"提交高等数学第三次作业","type":"COURSE_WORK",
                                "deadline":"2026-10-15T23:59:00","priority":1,"description":"提交到学习通"}]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].source").value("AI_PARSE"))
                .andExpect(jsonPath("$.data[0].status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        long taskId = json.readTree(created).path("data").get(0).path("id").asLong();

        // 列表与筛选（本人可见；他人不可见）
        mvc.perform(get("/api/tasks").header("X-API-Key", FIRST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(1)));
        mvc.perform(get("/api/tasks").header("X-API-Key", SECOND))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(0)));
        mvc.perform(get("/api/tasks").header("X-API-Key", FIRST)
                        .param("status", "PENDING").param("type", "COURSE_WORK"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(1)));
        mvc.perform(get("/api/tasks").header("X-API-Key", FIRST).param("status", "DONE"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(0)));
        mvc.perform(get("/api/tasks").header("X-API-Key", FIRST)
                        .param("deadlineAfter", "2026-10-01T00:00:00"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(1)));
        mvc.perform(get("/api/tasks").header("X-API-Key", FIRST).param("status", "FLYING"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));

        // 越权读写一律 404
        mvc.perform(get("/api/tasks/{id}", taskId).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/tasks/{id}", taskId).header("X-API-Key", SECOND)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"篡改\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/tasks/{id}", taskId).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());

        // 状态流转
        mvc.perform(patch("/api/tasks/{id}/status", taskId).header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DONE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DONE"));
        mvc.perform(patch("/api/tasks/{id}/status", taskId).header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"MAYBE\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));

        // 修改（补丁语义：未提供的字段保持原值，deadline 显式清除）
        mvc.perform(put("/api/tasks/{id}", taskId).header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"提交高等数学第三次作业（修订）","deadline":null,"description":""}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("提交高等数学第三次作业（修订）"))
                .andExpect(jsonPath("$.data.deadline").value(nullValue()))
                .andExpect(jsonPath("$.data.type").value("COURSE_WORK"))
                .andExpect(jsonPath("$.data.priority").value(1));

        // 删除后 404
        mvc.perform(delete("/api/tasks/{id}", taskId).header("X-API-Key", FIRST))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tasks/{id}", taskId).header("X-API-Key", FIRST))
                .andExpect(status().isNotFound());
    }

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }
}
