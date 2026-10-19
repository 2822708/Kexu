package com.timetable.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.TimetableApplication;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * provider 界面配置端点（成本治理 6.1 #2）。
 *
 * <p>走真实鉴权链路：这条路径的安全性完全依赖 403 拦截是否真的挡得住，
 * 用 mock 掉鉴权去测等于没测。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:llm_provider_endpoint;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=admin-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "app.backup.enabled=false",
        // 桌面端由外壳用 DPAPI 保护主密钥后经环境变量传入，测试里直接给明文主密钥
        "TANGENT_SETTINGS_ENCRYPTION_KEY=unit-test-master-key",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class LlmProviderEndpointTest {

    /** 与上面 properties 里的 app.admin-api-keys 同值（注解值须为编译期常量，不能用 repeat） */
    static final String ADMIN = "admin-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    private static final String USER = "device_" + "c".repeat(43);
    private static final Path TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-providers-" + UUID.randomUUID());

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR.toString());
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate sql;
    @Autowired LlmClientRegistry registry;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetState() throws Exception {
        for (String table : List.of("daily_plan", "task", "exam", "course", "schedule",
                "student_profile", "student_memory", "api_key")) {
            sql.update("DELETE FROM " + table);
        }
        when(provider.isConfigured()).thenReturn(true);
        // 管理员身份要求 api_key 表里有这条记录：app.admin-api-keys 只是给已注册账号提权
        if (sql.queryForObject("SELECT COUNT(*) FROM api_key WHERE api_key=?", Integer.class, ADMIN) == 0) {
            sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'ADMIN')",
                    ADMIN, "Provider admin");
        }
        // 上一个用例可能留下配置，删干净（用端点删，顺带验证幂等）
        for (String id : List.of("glm", "qwen", "bad")) {
            mvc.perform(delete("/api/ai/providers/" + id).header("X-API-Key", ADMIN));
        }
    }

    @Test
    void adminCanAddProviderAndItBecomesAvailableWithoutRestart() throws Exception {
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "glm",
                                "baseUrl", "https://open.bigmodel.cn/api/paas/v4",
                                "model", "glm-4-flash",
                                "apiKey", "sk-test-key-123456"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.providers[*].id", hasItem("glm")))
                .andExpect(jsonPath("$.data.providers[?(@.id=='glm')].model").value("glm-4-flash"))
                // 只回掩码，绝不回显完整 Key
                .andExpect(jsonPath("$.data.providers[?(@.id=='glm')].keyMasked").value("sk-t****3456"))
                .andExpect(jsonPath("$.data.ready", hasItem("glm")));

        // 不重启即可用 —— 这是整个功能存在的意义
        assertThat(registry.registeredProviders()).contains("glm");
        assertThat(registry.isActiveConfigured()).isTrue();
    }

    @Test
    void keyIsEncryptedOnDisk() throws Exception {
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "glm", "baseUrl", "https://a.example.com",
                                "model", "m", "apiKey", "sk-super-secret-value"))))
                .andExpect(status().isOk());

        Path settings = TEST_DATA_DIR.resolve("settings.properties");
        assertThat(settings).exists();
        String content = Files.readString(settings);
        assertThat(content)
                .as("界面填的 Key 必须加密落盘，不能明文出现在配置文件中")
                .doesNotContain("sk-super-secret-value");
        // Properties.store 会把 "=" ":" 都转义成 "\\=" "\\:"，所以只断言键名与加密标记，不写完整字面量
        assertThat(content).contains("llm.provider.glm.api-key=");
        assertThat(content.replace("\\", "")).contains("ENCv1:");
    }

    @Test
    void omittingApiKeyKeepsTheExistingOne() throws Exception {
        save("glm", "https://a.example.com", "glm-4", "sk-original-key-value");

        // 只改模型名，不带 apiKey
        save("glm", "https://a.example.com", "glm-4-plus", null);

        mvc.perform(get("/api/ai/providers").header("X-API-Key", ADMIN))
                .andExpect(jsonPath("$.data.providers[?(@.id=='glm')].model").value("glm-4-plus"))
                .andExpect(jsonPath("$.data.providers[?(@.id=='glm')].keyMasked")
                        .value("sk-o****alue"));
    }

    @Test
    void deleteFallsBackToNothing() throws Exception {
        save("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "sk-qwen-key-1");

        mvc.perform(delete("/api/ai/providers/qwen").header("X-API-Key", ADMIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.providers[*].id", org.hamcrest.Matchers.not(hasItem("qwen"))));
    }

    @Test
    void nonAdminCannotWrite() throws Exception {
        register(USER);
        mvc.perform(put("/api/ai/providers").header("X-API-Key", USER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "glm", "baseUrl", "https://a.example.com",
                                "model", "m", "apiKey", "sk-attacker-key"))))
                .andExpect(status().isForbidden());
        assertThat(registry.registeredProviders()).doesNotContain("glm");
    }

    @Test
    void rejectsMalformedInput() throws Exception {
        // 非 http(s) 协议
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "bad", "baseUrl", "file:///etc/passwd",
                                "model", "m", "apiKey", "sk-xxxxxxxx"))))
                .andExpect(status().isBadRequest());
        // 标识含路径穿越
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "../evil", "baseUrl", "https://a.example.com",
                                "model", "m", "apiKey", "sk-xxxxxxxx"))))
                .andExpect(status().isBadRequest());
        // deepseek 有独立入口，不允许在这里改，避免两个入口互相打架
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "id", "deepseek", "baseUrl", "https://api.deepseek.com",
                                "model", "deepseek-chat", "apiKey", "sk-xxxxxxxx"))))
                .andExpect(status().isBadRequest());
    }

    // ==================== 辅助 ====================

    private void save(String id, String baseUrl, String model, String apiKey) throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("id", id);
        body.put("baseUrl", baseUrl);
        body.put("model", model);
        if (apiKey != null) {
            body.put("apiKey", apiKey);
        }
        mvc.perform(put("/api/ai/providers").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(body)))
                .andExpect(status().isOk());
    }

    private ResultActions register(String key) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }
}
