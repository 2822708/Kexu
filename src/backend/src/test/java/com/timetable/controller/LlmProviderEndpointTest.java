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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
        // 默认 provider 也要复位：它不在上面那个循环的清理范围里（删 provider 才连带清），
        // 留着会让别的用例看到「默认是 glm」
        mvc.perform(delete("/api/ai/providers/active").header("X-API-Key", ADMIN));
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


    @Test
    void testEndpointRejectsUnknownProvider() throws Exception {
        // 不存在的 provider 应当 404，而不是拿空配置去发请求
        mvc.perform(post("/api/ai/providers/nope/test").header("X-API-Key", ADMIN))
                .andExpect(status().isNotFound());
    }

    @Test
    void testEndpointOnlyUsesSavedConfigNeverClientSuppliedUrl() throws Exception {
        // 关键安全断言：请求体里塞什么地址都不该被采用，否则这就是 SSRF 跳板
        mvc.perform(post("/api/ai/providers/glm/test").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of(
                                "baseUrl", "http://169.254.169.254/latest/meta-data/"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void testEndpointRequiresAdmin() throws Exception {
        register(USER);
        save("glm", "https://a.example.com", "m", "sk-testing-key-1234");
        mvc.perform(post("/api/ai/providers/glm/test").header("X-API-Key", USER))
                .andExpect(status().isForbidden());
    }

    @Test
    void testEndpointReportsConnectionFailureForUnreachableHost() throws Exception {
        // 地址语法合法但连不上：应当 200 + ok=false（这是「测试结果」，不是接口错误）
        save("glm", "http://127.0.0.1:1/v1", "m", "sk-testing-key-1234");
        mvc.perform(post("/api/ai/providers/glm/test").header("X-API-Key", ADMIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ok").value(false))
                .andExpect(jsonPath("$.data.error").isNotEmpty())
                .andExpect(jsonPath("$.data.providerId").value("glm"));
    }

    // ==================== 默认 provider 切换 ====================

    @Test
    void adminCanSwitchActiveProviderAndItTakesEffectImmediately() throws Exception {
        save("glm", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "sk-glm-key-123456");

        mvc.perform(put("/api/ai/providers/active").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("id", "glm"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.activeProvider").value("glm"))
                .andExpect(jsonPath("$.data.activeSource").value("local"));

        assertThat(registry.activeProviderId())
                .as("切完要立刻生效，不需要重启")
                .isEqualTo("glm");
    }

    /**
     * 把默认设成配置不全的 provider 必须被拒绝。
     *
     * <p>如果放行，用户点完不会看到任何异常，问题要等下一次对话才炸出来，
     * 而且报错完全不指向这里——这是最坏的一类失败。
     */
    @Test
    void switchingToIncompleteProviderIsRejected() throws Exception {
        save("glm", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", null);

        mvc.perform(put("/api/ai/providers/active").header("X-API-Key", ADMIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("id", "glm"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不能设为默认")));
    }

    @Test
    void resettingActiveProviderFallsBackToConfig() throws Exception {
        save("glm", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "sk-glm-key-123456");
        mvc.perform(put("/api/ai/providers/active").header("X-API-Key", ADMIN)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("id", "glm"))));

        // 这条同时钉住路由：/active 不能被 /{id} 抢走，否则会走成「删除 provider active」
        mvc.perform(delete("/api/ai/providers/active").header("X-API-Key", ADMIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.activeProvider").value("deepseek"))
                .andExpect(jsonPath("$.data.activeSource").value("config"))
                .andExpect(jsonPath("$.data.providers[*].id", hasItem("glm")));
    }

    @Test
    void nonAdminCannotSwitchActiveProvider() throws Exception {
        register(USER);
        save("glm", "https://a.example.com", "m", "sk-testing-key-1234");

        mvc.perform(put("/api/ai/providers/active").header("X-API-Key", USER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(Map.of("id", "glm"))))
                .andExpect(status().isForbidden());
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
