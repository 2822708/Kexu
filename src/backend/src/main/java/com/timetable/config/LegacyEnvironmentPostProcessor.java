package com.timetable.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Read-only legacy aliases. Explicit Kexu configuration always wins; no data is moved or overwritten. */
public final class LegacyEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {
    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> aliases = new LinkedHashMap<>();
        for (String suffix : new String[]{"PORT", "DATA_DIR", "COMMON_PASSWORD", "BOOTSTRAP_KEY", "SETTINGS_ENCRYPTION_KEY"}) {
            String current = "KEXU_" + suffix;
            if (environment.getProperty(current) == null) {
                String prior = environment.getProperty(LegacyIdentifiers.ENV_PREFIX + suffix);
                if (prior != null) aliases.put(current, prior);
            }
        }
        if (!aliases.containsKey("KEXU_DATA_DIR") && environment.getProperty("KEXU_DATA_DIR") == null) {
            Path userDirectory = Path.of(System.getProperty("user.home"));
            Path current = userDirectory.resolve(".kexu");
            Path prior = userDirectory.resolve(LegacyIdentifiers.DATA_DIRECTORY);
            if (!Files.exists(current) && Files.isDirectory(prior)) aliases.put("KEXU_DATA_DIR", prior.toString().replace('\\', '/'));
        }
        environment.getPropertySources().addLast(new MapPropertySource("kexu-legacy-environment", aliases));
    }

    @Override
    public int getOrder() { return Ordered.LOWEST_PRECEDENCE; }
}
