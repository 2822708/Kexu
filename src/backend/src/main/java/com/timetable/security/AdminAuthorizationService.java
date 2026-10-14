package com.timetable.security;

import com.timetable.entity.ApiKey;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.ApiKeyMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AdminAuthorizationService {

    private final ApiKeyMapper apiKeyMapper;
    private final Set<String> configuredAdminKeys;

    public AdminAuthorizationService(
            ApiKeyMapper apiKeyMapper,
            @Value("${app.admin-api-keys:}") String configuredAdminKeys) {
        this.apiKeyMapper = apiKeyMapper;
        this.configuredAdminKeys = Arrays.stream(configuredAdminKeys.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isAdmin(ApiKey account) {
        return account != null && ("ADMIN".equalsIgnoreCase(account.getRole())
                || configuredAdminKeys.contains(account.getApiKey()));
    }

    public boolean isAdmin(String apiKey) {
        return isAdmin(apiKeyMapper.selectById(apiKey));
    }

    public void requireAdmin(String apiKey) {
        if (!isAdmin(apiKey)) {
            throw new BusinessException(403, "当前账号没有管理员权限");
        }
    }
}
