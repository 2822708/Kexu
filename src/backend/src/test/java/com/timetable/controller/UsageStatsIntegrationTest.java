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
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 成本度量端点（成本治理 P0-1）。
 *
 * 真实应用启动 + 真实鉴权 + 真实迁移（含 V5）。重点验证三件事：
 * ① 账号隔离——SECOND 绝对看不到 FIRST 的 token 成本；
 * ② 成本估算 = token × 配置单价，数字精确可预期；
 * ③ 提案决定时刻 decided_at 确实落库（这是确认率与响应耗时的数据基础）。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:usage_stats;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN",
        // 固定单价，让成本断言得到确定值：1 元/百万 input，10 元/百万 output
        "app.llm.pricing.per-million.input=1.0",
        "app.llm.pricing.per-million.output=10.0",
        "app.llm.pricing.models.deepseek-flash.input=1.0",
        "app.llm.pricing.models.deepseek-flash.output=10.0"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class UsageStatsIntegrationTest {

    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-usage-" + UUID.randomUUID()).toString();

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate sql;
    @MockBean LlmClient provider;

    @BeforeEach
    void cleanTables() {
        // 内存库跨测试方法复用，清干净让每个用例的断言只反映自己造的数
        sql.update("DELETE FROM llm_usage");
        sql.update("DELETE FROM ai_event");
        sql.update("DELETE FROM ai_action");
    }

    @Test
    void usageRequiresAuth() throws Exception {
        register(FIRST);
        mvc.perform(get("/api/stats/usage")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/stats/proposals")).andExpect(status().isUnauthorized());
    }

    @Test
    void usageAggregatesTokensScenesAndEstimatedCost() throws Exception {
        register(FIRST);
        // 1000 input + 2000 output = 3000 token
        // 成本 = 1000*1/1e6 + 2000*10/1e6 = 0.001 + 0.02 = 0.021 元
        seedUsage(FIRST, "CHAT", 1000, 2000, "SUCCESS", 1200);
        seedUsage(FIRST, "EXTRACT", 500, 500, "SUCCESS", 800);
        // 失败调用也要计入成本：100 input 已花掉
        seedUsage(FIRST, "OCR", 100, 0, "ERROR", 5000);

        mvc.perform(get("/api/stats/usage").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.callCount").value(3))
                .andExpect(jsonPath("$.data.errorCount").value(1))
                .andExpect(jsonPath("$.data.promptTokens").value(1600))
                .andExpect(jsonPath("$.data.completionTokens").value(2500))
                .andExpect(jsonPath("$.data.totalTokens").value(4100))
                // 0.001+0.02 + (0.0005+0.005) + 0.0001 = 0.0266
                .andExpect(jsonPath("$.data.estimatedCost").value(0.0266))
                // (1200+800+5000)/3 = 2333.33→ 截断为 2333
                .andExpect(jsonPath("$.data.avgLatencyMs").value(2333))
                .andExpect(jsonPath("$.data.scenes.length()").value(3))
                .andExpect(jsonPath("$.data.scenes[0].scene").value("CHAT"))
                .andExpect(jsonPath("$.data.scenes[0].sceneLabel").value("对话"))
                .andExpect(jsonPath("$.data.scenes[0].totalTokens").value(3000));
    }

    @Test
    void usageNeverLeaksOtherAccountsTokens() throws Exception {
        register(FIRST);
        register(SECOND);
        seedUsage(FIRST, "CHAT", 999_999, 0, "SUCCESS", 100);

        // SECOND 看不到 FIRST 的数据：全部统计为 0
        mvc.perform(get("/api/stats/usage").header("X-API-Key", SECOND))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.callCount").value(0))
                .andExpect(jsonPath("$.data.totalTokens").value(0))
                .andExpect(jsonPath("$.data.scenes.length()").value(0));

        // FIRST 自己看得到
        mvc.perform(get("/api/stats/usage").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.callCount").value(1))
                .andExpect(jsonPath("$.data.totalTokens").value(999_999));
    }

    @Test
    void usageRespectsWindowAndClampsInvalidDays() throws Exception {
        register(FIRST);
        // 45 天前的记录
        seedUsageAt(FIRST, "CHAT", 1000, 0, LocalDateTime.now().minusDays(45));
        seedUsage(FIRST, "CHAT", 500, 0, "SUCCESS", 100);

        mvc.perform(get("/api/stats/usage").header("X-API-Key", FIRST).param("days", "30"))
                .andExpect(jsonPath("$.data.callCount").value(1))
                .andExpect(jsonPath("$.data.totalTokens").value(500));

        // days=0 被夹到 1 天，仍只看当天那条
        mvc.perform(get("/api/stats/usage").header("X-API-Key", FIRST).param("days", "0"))
                .andExpect(jsonPath("$.data.days").value(1))
                .andExpect(jsonPath("$.data.callCount").value(1));

        // 超大值被夹到 365，不报错
        mvc.perform(get("/api/stats/usage").header("X-API-Key", FIRST).param("days", "99999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.days").value(365))
                .andExpect(jsonPath("$.data.callCount").value(2));
    }

    @Test
    void proposalFunnelCountsConfirmRateAndDecideLatency() throws Exception {
        register(FIRST);
        // 3 已确认（其中 1 个带决定时刻）+ 1 拒绝 + 1 失效+ 1 待处理
        seedAction(FIRST, "EXECUTED", "2026-10-10T10:00:00", "2026-10-10T10:00:30");
        seedAction(FIRST, "EXECUTED", "2026-10-10T11:00:00", null);
        seedAction(FIRST, "EXECUTED", "2026-10-10T12:00:00", null);
        seedAction(FIRST, "REJECTED", "2026-10-10T13:00:00", null);
        seedAction(FIRST, "STALE", "2026-10-10T14:00:00", null);
        seedAction(FIRST, "PENDING", "2026-10-10T15:00:00", null);

        mvc.perform(get("/api/stats/proposals").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.executedCount").value(3))
                .andExpect(jsonPath("$.data.rejectedCount").value(1))
                .andExpect(jsonPath("$.data.staleCount").value(1))
                .andExpect(jsonPath("$.data.pendingCount").value(1))
                .andExpect(jsonPath("$.data.decidedCount").value(5))
                // 3 / 5 = 60%
                .andExpect(jsonPath("$.data.confirmRate").value(60.0))
                // 只有一条有决定时刻：30 秒
                .andExpect(jsonPath("$.data.avgDecideSeconds").value(30.0));
    }

    @Test
    void proposalFunnelHandlesEmptyAndNeverDecidedData() throws Exception {
        register(FIRST);
        // 全空：分母为 0，两个指标都应是 null 而不是 0（0 会被读成「确认率 0%」）
        mvc.perform(get("/api/stats/proposals").header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.decidedCount").value(0))
                .andExpect(jsonPath("$.data.confirmRate").doesNotExist())
                .andExpect(jsonPath("$.data.avgDecideSeconds").doesNotExist());

        // 有提案但都还没决定
        seedAction(FIRST, "PENDING", "2026-10-10T10:00:00", null);
        mvc.perform(get("/api/stats/proposals").header("X-API-Key", FIRST))
                .andExpect(jsonPath("$.data.pendingCount").value(1))
                .andExpect(jsonPath("$.data.confirmRate").doesNotExist());
    }

    @Test
    void proposalFunnelNeverLeaksOtherAccountsProposals() throws Exception {
        register(FIRST);
        register(SECOND);
        seedAction(FIRST, "EXECUTED", "2026-10-10T10:00:00", null);

        mvc.perform(get("/api/stats/proposals").header("X-API-Key", SECOND))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.executedCount").value(0))
                .andExpect(jsonPath("$.data.decidedCount").value(0));
    }

    @Test
    void v5MigrationAddsDecidedAtToExistingRows() throws Exception {
        // decided_at 必须是可空列：存量行迁移后没有决定时刻，插入与统计都不能炸
        Long id = seedAction(FIRST, "PENDING", "2026-10-10T10:00:00", null);
        Integer nullDecidedAt = sql.queryForObject(
                "SELECT COUNT(*) FROM ai_action WHERE id = ? AND decided_at IS NULL",
                Integer.class, id);
        assertThat(nullDecidedAt).isEqualTo(1);

        // llm_usage / ai_event 两张新表已在，且 V5 新增的列都齐了。
        // TABLE_NAME / COLUMN_NAME 在 H2 的 INFORMATION_SCHEMA 里大小写随建表语句与存储策略走，
        // 所以统一 UPPER 后比较，避免这个用例因为大小写而假失败。
        Integer cols = sql.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = 'LLM_USAGE'",
                Integer.class);
        assertThat(cols).isNotNull().isPositive();

        Integer usageCols = sql.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = 'LLM_USAGE'"
                        + " AND UPPER(COLUMN_NAME) IN ('API_KEY','SCENE','PROVIDER','MODEL','PROMPT_TOKENS',"
                        + "'COMPLETION_TOKENS','TOTAL_TOKENS','STREAM','LATENCY_MS','STATUS','CREATED_AT')",
                Integer.class);
        assertThat(usageCols).isEqualTo(11);

        Integer eventCols = sql.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = 'AI_EVENT'"
                        + " AND UPPER(COLUMN_NAME) IN ('API_KEY','EVENT_TYPE','SCENE','ACTION_TYPE','REF_ID','CREATED_AT')",
                Integer.class);
        assertThat(eventCols).isEqualTo(6);
    }

    // ==================== 辅助 ====================

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }

    private void seedUsage(String apiKey, String scene, int prompt, int completion,
                            String status, int latencyMs) {
        sql.update("INSERT INTO llm_usage(api_key,scene,provider,model,prompt_tokens,completion_tokens,"
                        + "total_tokens,stream,latency_ms,status,created_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                apiKey, scene, "deepseek", "deepseek-flash", prompt, completion,
                prompt + completion, false, latencyMs, status, Timestamp.valueOf(LocalDateTime.now()));
    }

    private void seedUsageAt(String apiKey, String scene, int prompt, int completion,
                             LocalDateTime at) {
        sql.update("INSERT INTO llm_usage(api_key,scene,provider,model,prompt_tokens,completion_tokens,"
                        + "total_tokens,stream,latency_ms,status,created_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                apiKey, scene, "deepseek", "deepseek-flash", prompt, completion,
                prompt + completion, false, 100, "SUCCESS", Timestamp.valueOf(at));
    }

    private Long seedAction(String apiKey, String status, String createdAt, String decidedAt) {
        // 设备注册不会自动建会话，这里自己造一条以满足 ai_action 的外键约束。
        // 注意用 queryForList 而非 queryForObject：后者在空结果时抛
        // EmptyResultDataAccessException 而不是返回 null。
        java.util.List<Long> existing = sql.queryForList(
                "SELECT id FROM ai_conversation WHERE api_key = ? ORDER BY id DESC LIMIT 1",
                Long.class, apiKey);
        Long conversationId = existing.isEmpty() ? null : existing.get(0);
        if (conversationId == null) {
            sql.update("INSERT INTO ai_conversation(api_key,title) VALUES (?,?)",
                    apiKey, "stats test");
            java.util.List<Long> created = sql.queryForList(
                    "SELECT id FROM ai_conversation WHERE api_key = ? ORDER BY id DESC LIMIT 1",
                    Long.class, apiKey);
            conversationId = created.isEmpty() ? null : created.get(0);
        }
        final Long convId = conversationId;
        // 用 GeneratedKeyHolder 拿自增主键：queryForObject(insert) 的重载在 Long.class 上有歧义
        org.springframework.jdbc.support.GeneratedKeyHolder holder = new org.springframework.jdbc.support.GeneratedKeyHolder();
        sql.update(connection -> {
            var ps = connection.prepareStatement(
                    "INSERT INTO ai_message(conversation_id,role,content,created_at) VALUES (?,?,?,?)",
                    new String[]{"id"});
            ps.setLong(1, convId);
            ps.setString(2, "assistant");
            ps.setString(3, "{}");
            ps.setTimestamp(4, Timestamp.valueOf(LocalDateTime.parse(createdAt)));
            return ps;
        }, holder);
        Long messageId = holder.getKey().longValue();
        sql.update("INSERT INTO ai_action(message_id,api_key,scope,action_type,action_status,"
                        + "action_data,sort_order,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?)",
                messageId, apiKey, "COURSE", "CREATE_COURSE", status, "{}", 0,
                Timestamp.valueOf(LocalDateTime.parse(createdAt)),
                decidedAt == null ? null : Timestamp.valueOf(LocalDateTime.parse(decidedAt)));
        return sql.queryForObject("SELECT MAX(id) FROM ai_action WHERE api_key = ?", Long.class, apiKey);
    }
}