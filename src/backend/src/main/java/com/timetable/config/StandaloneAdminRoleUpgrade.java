package com.timetable.config;

import com.timetable.entity.ApiKey;
import com.timetable.mapper.ApiKeyMapper;
import com.timetable.security.DeviceIdentity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.List;

/** The desktop database is single-user; preserve admin access for its legacy account. */
@Component
@Profile("standalone")
@Order(Ordered.LOWEST_PRECEDENCE)
public class StandaloneAdminRoleUpgrade implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(StandaloneAdminRoleUpgrade.class);

    private final ApiKeyMapper apiKeyMapper;

    public StandaloneAdminRoleUpgrade(ApiKeyMapper apiKeyMapper) {
        this.apiKeyMapper = apiKeyMapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<ApiKey> accounts = apiKeyMapper.selectList(null);
        if (accounts.size() != 1) {
            return;
        }
        ApiKey account = accounts.get(0);
        // A newly self-registered browser must not gain administrator access after a restart.
        if (DeviceIdentity.isDeviceKey(account.getApiKey())) {
            return;
        }
        if (!"ADMIN".equalsIgnoreCase(account.getRole())) {
            account.setRole("ADMIN");
            apiKeyMapper.updateById(account);
            log.info("Upgraded the sole legacy standalone account to administrator role");
        }
    }
}
