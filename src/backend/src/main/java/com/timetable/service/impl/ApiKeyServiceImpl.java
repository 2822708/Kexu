package com.timetable.service.impl;

import com.timetable.dto.AuthVerifyResponse;
import com.timetable.entity.ApiKey;
import com.timetable.mapper.ApiKeyMapper;
import com.timetable.service.ApiKeyService;
import com.timetable.security.AdminAuthorizationService;
import org.springframework.stereotype.Service;

@Service
public class ApiKeyServiceImpl implements ApiKeyService {

    private final ApiKeyMapper apiKeyMapper;
    private final AdminAuthorizationService adminAuthorizationService;

    public ApiKeyServiceImpl(ApiKeyMapper apiKeyMapper, AdminAuthorizationService adminAuthorizationService) {
        this.apiKeyMapper = apiKeyMapper;
        this.adminAuthorizationService = adminAuthorizationService;
    }

    @Override
    public AuthVerifyResponse verify(String apiKey) {
        ApiKey key = apiKeyMapper.selectById(apiKey);
        if (key == null) {
            return new AuthVerifyResponse(false, null);
        }
        return new AuthVerifyResponse(true, key.getLabel(), key.getAvatarUrl(),
                adminAuthorizationService.isAdmin(key) ? "ADMIN" : "USER");
    }
}
