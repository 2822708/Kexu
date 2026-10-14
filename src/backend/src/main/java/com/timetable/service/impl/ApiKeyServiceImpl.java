package com.timetable.service.impl;

import com.timetable.dto.AuthVerifyResponse;
import com.timetable.entity.ApiKey;
import com.timetable.mapper.ApiKeyMapper;
import com.timetable.service.ApiKeyService;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.security.DeviceIdentity;
import com.timetable.exception.BusinessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Service
public class ApiKeyServiceImpl implements ApiKeyService {

    private static final int MAX_NEW_DEVICES_PER_MINUTE = 60;
    private long registrationWindowStarted = System.nanoTime();
    private int registrationsInWindow;

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

    @Override
    public synchronized AuthVerifyResponse registerDevice(String deviceKey) {
        if (!DeviceIdentity.isDeviceKey(deviceKey)) {
            throw new BusinessException(400, "设备凭据格式不正确");
        }
        if (apiKeyMapper.selectById(deviceKey) != null) {
            return verify(deviceKey);
        }

        // Bound anonymous account creation; normal reconnects never consume this allowance.
        long now = System.nanoTime();
        if (now - registrationWindowStarted >= TimeUnit.MINUTES.toNanos(1)) {
            registrationWindowStarted = now;
            registrationsInWindow = 0;
        }
        if (registrationsInWindow >= MAX_NEW_DEVICES_PER_MINUTE) {
            throw new BusinessException(429, "新设备连接较多，请稍后重试");
        }

        ApiKey device = new ApiKey();
        device.setApiKey(deviceKey);
        device.setLabel("本机设备");
        device.setRole("USER");
        try {
            apiKeyMapper.insert(device);
            registrationsInWindow++;
        } catch (DuplicateKeyException concurrentRegistration) {
            // Another server instance may have completed registration with the same secret.
            if (apiKeyMapper.selectById(deviceKey) == null) throw concurrentRegistration;
        }
        return verify(deviceKey);
    }
}
