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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 长期记忆管理端点（AI Campus Agent V1.0 Step 7）。
 *
 * 真实应用启动 + 真实鉴权 + 真实迁移：验证设置页的手动增删改即时生效、
 * 重复添加被合并、以及跨账号不可见/不可改。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:memory_endpoint;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class MemoryEndpointIntegrationTest {

    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-memory-" + UUID.randomUUID()).toString();

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
                "student_profile", "student_memory", "api_key")) {
            sql.update("DELETE FROM " + table);
        }
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void manualCreateEditArchiveAndDeleteApplyImmediately() throws Exception {
        register(FIRST).andExpect(status().isOk());

        Long id = create(FIRST, Map.of("type", "GOAL", "content", "准备 12 月 CET-6 考试", "importance", 5));
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.injected").value(1))
                .andExpect(jsonPath("$.data.limit").value(20))
                .andExpect(jsonPath("$.data.items", hasSize(1)))
                .andExpect(jsonPath("$.data.items[0].content").value("准备 12 月 CET-6 考试"))
                .andExpect(jsonPath("$.data.items[0].source").value("USER"))
                .andExpect(jsonPath("$.data.items[0].status").value("ACTIVE"));

        // 编辑：只传 content 与 importance，type 保持原值
        mvc.perform(patch("/api/memories/" + id).header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("content", "准备 12 月六级", "importance", 4))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.type").value("GOAL"))
                .andExpect(jsonPath("$.data.content").value("准备 12 月六级"))
                .andExpect(jsonPath("$.data.importance").value(4));
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.items[0].content").value("准备 12 月六级"));

        // 归档：不再出现在列表，但记录仍在（可审计）
        mvc.perform(post("/api/memories/" + id + "/archive").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("SUPERSEDED"));
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.items", hasSize(0)));
        assertThatRowSurvives();

        // 删除：彻底移除
        mvc.perform(delete("/api/memories/" + id).header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(true));
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void duplicateAddIsMergedAndInvalidInputRejected() throws Exception {
        register(FIRST).andExpect(status().isOk());

        Long first = create(FIRST, Map.of("type", "GOAL", "content", "准备 12 月 CET-6 考试", "importance", 2));
        Long second = create(FIRST, Map.of("type", "GOAL", "content", "准备12月CET-6考试！", "importance", 5));
        org.assertj.core.api.Assertions.assertThat(second).isEqualTo(first);
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].importance").value(5));

        // 空内容 400；非法类型 400；重要度越界由服务端收敛而非直接拒绝
        mvc.perform(post("/api/memories").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("content", "  "))))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/memories").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("type", "SECRET", "content", "越权类型"))))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.total").value(1));
    }

    @Test
    void memoriesAreInvisibleAndUnmodifiableAcrossAccounts() throws Exception {
        register(FIRST).andExpect(status().isOk());
        register(SECOND).andExpect(status().isOk());
        Long mine = create(FIRST, Map.of("type", "HABIT", "content", "习惯早睡", "importance", 3));

        mvc.perform(get("/api/memories").header("X-API-Key", SECOND))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(patch("/api/memories/" + mine).header("X-API-Key", SECOND)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("content", "越权改写"))))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/memories/" + mine).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/memories/" + mine + "/archive").header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/memories").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.items[0].content").value("习惯早睡"));
        // 未带 key 一律 401
        mvc.perform(get("/api/memories")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/memories").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("content", "匿名"))))
                .andExpect(status().isUnauthorized());
    }

    // ==================== 辅助 ====================

    private void assertThatRowSurvives() {
        Integer rows = sql.queryForObject("SELECT COUNT(*) FROM student_memory", Integer.class);
        org.assertj.core.api.Assertions.assertThat(rows).isEqualTo(1);
    }

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }

    private Long create(String key, Map<String, Object> body) throws Exception {
        String response = mvc.perform(post("/api/memories").header("X-API-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data").path("id").asLong();
    }
}
