package com.timetable.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.TimetableApplication;
import com.timetable.config.ApiKeyBootstrap;
import com.timetable.config.StandaloneAdminRoleUpgrade;
import com.timetable.mapper.ApiKeyMapper;
import com.timetable.service.DeepSeekClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real application startup, migration, MVC authentication and ownership checks; no user files or AI calls. */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:device_auth;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class DeviceAuthIntegrationTest {
    private static final String FIRST = "device_" + "a".repeat(43);
    private static final String SECOND = "device_" + "b".repeat(43);
    private static final String LEGACY = "legacy-test-account";
    private static final String BOOTSTRAP = "configured-bootstrap-test-account";
    private static final String TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-device-auth-" + UUID.randomUUID()).toString();

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate sql;
    @Autowired ApiKeyMapper accounts;
    @Autowired StandaloneAdminRoleUpgrade legacyUpgrade;
    @Autowired ThreadPoolTaskScheduler applicationTaskScheduler;
    @MockBean DeepSeekClient provider;

    @BeforeEach
    void clearDisposableAccounts() {
        sql.update("DELETE FROM schedule");
        sql.update("DELETE FROM api_key");
    }

    @Test
    void emptyStandaloneApplicationStartsAndRegistersWithoutBootstrapCredential() throws Exception {
        // This context includes SchedulingConfig and both startup runners, unlike the service-only regression suite.
        assertThat(applicationTaskScheduler.getScheduledThreadPoolExecutor().isShutdown()).isFalse();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM api_key", Integer.class)).isZero();

        register(FIRST)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.role").value("USER"))
                .andExpect(jsonPath("$.data.apiKey").doesNotExist())
                .andExpect(jsonPath("$.data.deviceKey").doesNotExist());

        mvc.perform(get("/api/schedules").header("X-API-Key", FIRST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(0)));
    }

    @Test
    void repeatRegistrationReusesAccountAndPreservesItsExistingProfileAndRole() throws Exception {
        register(FIRST).andExpect(status().isOk());
        sql.update("UPDATE api_key SET label=?,avatar_url=?,account_role='ADMIN' WHERE api_key=?",
                "Existing device", "https://example.test/avatar.png", FIRST);

        register(FIRST)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.label").value("Existing device"))
                .andExpect(jsonPath("$.data.avatarUrl").value("https://example.test/avatar.png"))
                .andExpect(jsonPath("$.data.role").value("ADMIN"));

        assertThat(sql.queryForObject("SELECT COUNT(*) FROM api_key", Integer.class)).isEqualTo(1);
        mvc.perform(get("/api/auth/verify").header("X-API-Key", FIRST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.role").value("ADMIN"));
    }

    @Test
    void differentDevicesCannotReadModifyOrDeleteEachOthersSchedules() throws Exception {
        register(FIRST).andExpect(status().isOk());
        register(SECOND).andExpect(status().isOk());
        long firstSchedule = createSchedule(FIRST, "First device schedule");
        createSchedule(SECOND, "Second device schedule");

        mvc.perform(get("/api/schedules").header("X-API-Key", FIRST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(1)))
                .andExpect(jsonPath("$.data[0].name").value("First device schedule"));
        mvc.perform(get("/api/schedules").header("X-API-Key", SECOND))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data", hasSize(1)))
                .andExpect(jsonPath("$.data[0].name").value("Second device schedule"));
        mvc.perform(get("/api/schedules/{id}", firstSchedule).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/schedules/{id}", firstSchedule).header("X-API-Key", SECOND)
                        .contentType(MediaType.APPLICATION_JSON).content(scheduleBody("Unauthorized edit")))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/schedules/{id}", firstSchedule).header("X-API-Key", SECOND))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/schedules/{id}", firstSchedule).header("X-API-Key", FIRST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.schedule.name").value("First device schedule"));
    }

    @Test
    void automaticRegistrationDoesNotMakeProtectedEndpointsPublic() throws Exception {
        mvc.perform(get("/api/schedules")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/schedules").contentType(MediaType.APPLICATION_JSON)
                        .content(scheduleBody("Unauthenticated")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/schedules").header("X-API-Key", FIRST))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/verify")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/verify").header("X-API-Key", "unknown-legacy-key"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.valid").value(false));
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM api_key", Integer.class)).isZero();
    }

    @Test
    void registrationRejectsMalformedOrLegacyCredentialsWithoutCreatingAccounts() throws Exception {
        for (String key : List.of("", "device_", "device_" + "a".repeat(42),
                "device_" + "a".repeat(44), "device_" + "/".repeat(43),
                " " + FIRST, "admin", LEGACY)) {
            register(key).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(400));
        }
        mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceKey\":null}"))
                .andExpect(status().isBadRequest());
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM api_key", Integer.class)).isZero();
    }

    @Test
    void loneDeviceAccountStaysOrdinaryUserAfterLegacyStandaloneUpgradeRunsAgain() throws Exception {
        register(FIRST).andExpect(status().isOk());
        legacyUpgrade.run(new DefaultApplicationArguments());

        assertThat(accounts.selectById(FIRST).getRole()).isEqualTo("USER");
        mvc.perform(get("/api/auth/verify").header("X-API-Key", FIRST))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.role").value("USER"));
        mvc.perform(put("/api/period-config").header("X-API-Key", FIRST)
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"configs":[{"periodNumber":1,"startTime":"08:10:00",
                                "endTime":"08:55:00","category":"MORNING"}]}
                                """))
                .andExpect(status().isForbidden());
    }

    @Test
    void legacyAccountsAndExplicitAdministratorBootstrapRemainUsable() throws Exception {
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", LEGACY, "Legacy user");
        long legacySchedule = createSchedule(LEGACY, "Existing timetable");
        legacyUpgrade.run(new DefaultApplicationArguments());

        mvc.perform(get("/api/auth/verify").header("X-API-Key", LEGACY))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.role").value("ADMIN"));
        register(LEGACY).andExpect(status().isBadRequest());
        register(FIRST).andExpect(status().isOk());
        mvc.perform(get("/api/schedules/{id}", legacySchedule).header("X-API-Key", LEGACY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.schedule.name").value("Existing timetable"));

        // Explicit bootstrap still initializes an administrator in an empty installation.
        clearDisposableAccounts();
        new ApiKeyBootstrap(accounts, BOOTSTRAP).run(new DefaultApplicationArguments());
        mvc.perform(get("/api/auth/verify").header("X-API-Key", BOOTSTRAP))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.role").value("ADMIN"));
        register(SECOND).andExpect(status().isOk()).andExpect(jsonPath("$.data.role").value("USER"));
    }

    private ResultActions register(String key) throws Exception {
        return mvc.perform(post("/api/auth/device").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(Map.of("deviceKey", key))));
    }

    private long createSchedule(String key, String name) throws Exception {
        String response = mvc.perform(post("/api/schedules").header("X-API-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(scheduleBody(name)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data").path("id").asLong();
    }

    private byte[] scheduleBody(String name) throws Exception {
        return json.writeValueAsBytes(Map.of("name", name, "periodStartDate", "2026-09-07",
                "periodEndDate", "2027-01-31"));
    }
}
