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
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 今日待阅通知箱的 HTTP 层验证。
 *
 * 真实应用启动 + 真实鉴权拦截器 + 真实 Flyway 迁移（含 V6），只 mock 外部 LLM。
 * 覆盖：未登录 401、草稿提炼不落库、确认落库、账号隔离、忽略/稍后/转任务的状态流转、
 * 同来源降权排序、V6 迁移列完整性。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:notice_endpoint;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class NoticeEndpointIntegrationTest {

    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-notice-endpoint-" + UUID.randomUUID()).toString();

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
        sql.update("DELETE FROM notice_card");
        sql.update("DELETE FROM task");
        sql.update("DELETE FROM schedule");
        sql.update("DELETE FROM api_key");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void endpointsRequireAuthentication() throws Exception {
        mvc.perform(get("/api/notices")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/notices/extract").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"学院通知\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/notices").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cards\":[]}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/notices/1/ignore").header("X-API-Key", FIRST))
                .andExpect(status().isUnauthorized());
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM notice_card", Integer.class)).isZero();
    }

    @Test
    void extractDoesNotPersistUntilConfirmed() throws Exception {
        register(FIRST);
        when(provider.chatJson(any(), any())).thenReturn("""
                {"cards":[
                  {"source":"学院通知","title":"校创新创业大赛报名开启","summary":"面向全校","keyTime":null,
                   "requirement":"团队 3-5 人","relevance":1}
                ],"confidence":0.8}""");

        mvc.perform(post("/api/notices/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"学院通知：校创新创业大赛报名开启，团队3-5人\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cards", hasSize(1)))
                .andExpect(jsonPath("$.data.cards[0].title").value("校创新创业大赛报名开启"))
                .andExpect(jsonPath("$.data.cards[0].relevance").value(1));

        // 提炼是 human-in-the-loop 的草稿阶段：一行都不能落库
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM notice_card WHERE api_key=?",
                Integer.class, FIRST)).isZero();

        // 确认后才写表
        mvc.perform(post("/api/notices").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"cards\":[{\"source\":\"学院通知\",\"title\":\"校创新创业大赛报名开启\",\"relevance\":1}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", hasSize(1)));
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM notice_card WHERE api_key=? AND status='PENDING'",
                Integer.class, FIRST)).isEqualTo(1);
    }

    @Test
    void extractRejectsBlankText() throws Exception {
        register(FIRST);
        mvc.perform(post("/api/notices/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void pastKeyTimeIsCleanedToNull() throws Exception {
        register(FIRST);
        // 模型偶尔会忽略「过去的时间填 null」的规则，服务端必须再拦一道
        when(provider.chatJson(any(), any())).thenReturn("""
                {"cards":[{"source":"班委通知","title":"上周班会","keyTime":"2020-01-01 10:00","relevance":2}],
                 "confidence":0.5}""");
        mvc.perform(post("/api/notices/extract").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"上周班会\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cards[0].keyTime").value(nullValue()));
    }

    @Test
    void neverLeaksOtherAccountsNotices() throws Exception {
        register(FIRST);
        register(SECOND);
        Long id = seedNotice(FIRST, "学院通知", "A 同学的竞赛报名", "PENDING", null);

        mvc.perform(get("/api/notices").header("X-API-Key", SECOND))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", hasSize(0)));

        // 归属不符返回 404 而不是 403：403 等于告诉对方「这条数据存在但不是你的」
        mvc.perform(post("/api/notices/" + id + "/ignore").header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/notices/" + id).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        assertThat(sql.queryForObject("SELECT status FROM notice_card WHERE id=?", String.class, id))
                .isEqualTo("PENDING");
    }

    @Test
    void ignoreSnoozeAndToTaskMoveCardThroughStates() throws Exception {
        register(FIRST);
        Long id = seedNotice(FIRST, "图书馆", "新到柔性电子材料专著", "PENDING", null);

        // 稍后提醒：卡片暂时移出待阅列表
        mvc.perform(post("/api/notices/" + id + "/snooze").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"hours\":4}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/notices").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data", hasSize(0)));
        // 到点后自动回来
        sql.update("UPDATE notice_card SET snooze_until=? WHERE id=?",
                LocalDateTime.now().minusMinutes(1), id);
        mvc.perform(get("/api/notices").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data", hasSize(1)));

        // 加入日程：转任务 + 卡片置 DONE，且同一条不能转第二次
        mvc.perform(post("/api/notices/" + id + "/to-task").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"去图书馆借书\",\"type\":\"OTHER\",\"priority\":2,\"description\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DONE"));
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM task WHERE api_key=? AND source='AI_PARSE'",
                Integer.class, FIRST)).isEqualTo(1);
        mvc.perform(post("/api/notices/" + id + "/to-task").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());

        // 忽略：保留数据但移出待阅
        Long other = seedNotice(FIRST, "班委通知", "班会时间调整", "PENDING", null);
        mvc.perform(post("/api/notices/" + other + "/ignore").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("IGNORED"));
        mvc.perform(get("/api/notices").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data", hasSize(0)));
        // 数据仍在，可追溯
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM notice_card WHERE api_key=?",
                Integer.class, FIRST)).isEqualTo(2);
    }

    /**
     * 同来源降权：忽略率过半的来源，其新卡片排到后面。
     *
     * 这是**显式规则**不是学习模型——没有权重训练、不更新用户画像。
     * 断言只验证排序，不验证任何"预测"。
     */
    @Test
    void heavilyIgnoredSourceIsSortedLast() throws Exception {
        register(FIRST);
        // 「水群」来源：3 条已决定里 3 条都被忽略 → 降权
        seedNotice(FIRST, "水群", "闲聊 1", "IGNORED", null);
        seedNotice(FIRST, "水群", "闲聊 2", "IGNORED", null);
        seedNotice(FIRST, "水群", "闲聊 3", "IGNORED", null);
        // 「教务处」来源：3 条都已转任务（没被忽略）→ 不降权
        seedNotice(FIRST, "教务处", "选课通知 1", "DONE", null);
        seedNotice(FIRST, "教务处", "选课通知 2", "DONE", null);
        seedNotice(FIRST, "教务处", "选课通知 3", "DONE", null);

        Long waterNew = seedNotice(FIRST, "水群", "新的水群消息", "PENDING", null);
        Long officeNew = seedNotice(FIRST, "教务处", "新的选课通知", "PENDING", null);

        mvc.perform(get("/api/notices").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", hasSize(2)))
                // 两条 relevance 都是 2，降权来源只能排在后面
                .andExpect(jsonPath("$.data[0].id").value(officeNew))
                .andExpect(jsonPath("$.data[1].id").value(waterNew));
    }

    /** 只看 1 条忽略就降权太激进，必须凑够样本量才生效。 */
    @Test
    void singleIgnoreDoesNotMuteSource() throws Exception {
        register(FIRST);
        seedNotice(FIRST, "社团", "活动 1", "IGNORED", null);
        Long clubNew = seedNotice(FIRST, "社团", "活动 2", "PENDING", null);
        Long officeNew = seedNotice(FIRST, "教务处", "选课通知", "PENDING", null);

        mvc.perform(get("/api/notices").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data", hasSize(2)))
                // 未降权时按 key_time 升序（都为空）→ id 升序
                .andExpect(jsonPath("$.data[0].id").value(Math.min(clubNew, officeNew)));
    }

    @Test
    void v6MigrationAddsNoticeCardTable() {
        Integer cols = sql.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = 'NOTICE_CARD'"
                        + " AND UPPER(COLUMN_NAME) IN ('API_KEY','SOURCE','TITLE','SUMMARY','KEY_TIME',"
                        + "'REQUIREMENT','RELEVANCE','STATUS','SNOOZE_UNTIL','CREATED_AT','UPDATED_AT')",
                Integer.class);
        assertThat(cols).isEqualTo(11);
    }

    // ==================== 辅助 ====================

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }

    private Long seedNotice(String apiKey, String source, String title, String status,
                            LocalDateTime keyTime) {
        sql.update("INSERT INTO notice_card(api_key,source,title,summary,key_time,requirement,"
                        + "relevance,status,snooze_until,created_at,updated_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                apiKey, source, title, "摘要", keyTime, null, 2, status, null,
                LocalDateTime.now(), LocalDateTime.now());
        return sql.queryForObject("SELECT MAX(id) FROM notice_card WHERE api_key=?", Long.class, apiKey);
    }
}
