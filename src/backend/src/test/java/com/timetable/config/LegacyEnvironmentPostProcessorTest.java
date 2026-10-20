package com.timetable.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;

class LegacyEnvironmentPostProcessorTest {
    @Test
    void acceptsPriorNamesWithoutOverridingCurrentConfiguration() {
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty(LegacyIdentifiers.ENV_PREFIX + "BOOTSTRAP_KEY", "synthetic-prior-key");
        environment.setProperty(LegacyIdentifiers.ENV_PREFIX + "PORT", "18081");
        environment.setProperty("KEXU_PORT", "18082");
        new LegacyEnvironmentPostProcessor().postProcessEnvironment(environment, null);
        assertThat(environment.getProperty("KEXU_BOOTSTRAP_KEY")).isEqualTo("synthetic-prior-key");
        assertThat(environment.getProperty("KEXU_PORT")).isEqualTo("18082");
    }

    @Test
    void springDiscoversAliasesBeforeResolvingStandaloneConfiguration() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "PORT", "18083")
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "DATA_DIR", "E:/synthetic-kexu-compat")
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "COMMON_PASSWORD", "synthetic-db-password")
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "BOOTSTRAP_KEY", "synthetic-bootstrap")
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "SETTINGS_ENCRYPTION_KEY", "synthetic-settings");
        try (ConfigurableApplicationContext context = start(environment)) {
            assertThat(context.getEnvironment().getProperty("server.port")).isEqualTo("18083");
            assertThat(context.getEnvironment().getProperty("app.data-dir")).isEqualTo("E:/synthetic-kexu-compat");
            assertThat(context.getEnvironment().getProperty("KEXU_COMMON_PASSWORD")).isEqualTo("synthetic-db-password");
            assertThat(context.getEnvironment().getProperty("app.bootstrap-key")).isEqualTo("synthetic-bootstrap");
            assertThat(context.getEnvironment().getProperty("KEXU_SETTINGS_ENCRYPTION_KEY")).isEqualTo("synthetic-settings");
        }
    }

    @Test
    void explicitCurrentConfigurationWinsDuringSpringStartup() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "PORT", "18083")
                .withProperty(LegacyIdentifiers.ENV_PREFIX + "DATA_DIR", "E:/synthetic-prior")
                .withProperty("KEXU_PORT", "18084")
                .withProperty("KEXU_DATA_DIR", "E:/synthetic-current")
                .withProperty("app.data-dir", "E:/synthetic-explicit");
        try (ConfigurableApplicationContext context = start(environment)) {
            assertThat(context.getEnvironment().getProperty("server.port")).isEqualTo("18084");
            assertThat(context.getEnvironment().getProperty("app.data-dir")).isEqualTo("E:/synthetic-explicit");
        }
    }

    private ConfigurableApplicationContext start(MockEnvironment environment) {
        SpringApplication application = new SpringApplication(AliasConfiguration.class);
        application.setEnvironment(environment);
        application.setWebApplicationType(WebApplicationType.NONE);
        application.setAdditionalProfiles("standalone");
        application.setLogStartupInfo(false);
        return application.run("--spring.main.banner-mode=off", "--logging.level.root=OFF");
    }

    @Configuration(proxyBeanMethods = false)
    static class AliasConfiguration {}
}
