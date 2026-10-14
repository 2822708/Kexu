package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.AuthVerifyResponse;
import com.timetable.dto.DeviceAuthRequest;
import com.timetable.service.ApiKeyService;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final ApiKeyService apiKeyService;

    public AuthController(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @GetMapping("/verify")
    public ApiResponse<AuthVerifyResponse> verify(@RequestHeader("X-API-Key") String apiKey) {
        return ApiResponse.success(apiKeyService.verify(apiKey));
    }

    @PostMapping("/device")
    public ApiResponse<AuthVerifyResponse> device(@Valid @RequestBody DeviceAuthRequest request,
                                                HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ApiResponse.success(apiKeyService.registerDevice(request.getDeviceKey()));
    }
}
