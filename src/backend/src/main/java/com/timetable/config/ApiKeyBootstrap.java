package com.timetable.config;

import com.timetable.entity.ApiKey;
import com.timetable.mapper.ApiKeyMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;

@Component
public class ApiKeyBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyBootstrap.class);

    private final ApiKeyMapper apiKeyMapper;
    private final String configuredKey;

    public ApiKeyBootstrap(ApiKeyMapper apiKeyMapper,
                           @Value("${app.bootstrap-key:}") String configuredKey) {
        this.apiKeyMapper = apiKeyMapper;
        this.configuredKey = configuredKey;
    }

    @Override
    public void run(ApplicationArguments args) {
        Long existing = apiKeyMapper.selectCount(null);
        if (existing != null && existing > 0) {
            return;
        }
        if (configuredKey == null || configuredKey.isBlank()) {
            log.info("No bootstrap account configured; devices can initialize their own workspaces on first connection.");
            return;
        }

        ApiKey account = new ApiKey();
        account.setApiKey(configuredKey.trim());
        account.setLabel("管理员");
        account.setRole("ADMIN");
        try {
            apiKeyMapper.insert(account);
            log.warn("Created the initial administrator account. The credential was supplied externally and was not logged.");
        } catch (DuplicateKeyException e) {
            log.info("First API key already created by another instance");
        }
    }
}
