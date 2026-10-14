package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.PeriodConfigRequest;
import com.timetable.entity.PeriodConfig;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.PeriodConfigService;
import com.timetable.security.AdminAuthorizationService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/period-config")
public class PeriodConfigController {

    private final PeriodConfigService periodConfigService;
    private final AdminAuthorizationService adminAuthorizationService;

    public PeriodConfigController(PeriodConfigService periodConfigService,
                                  AdminAuthorizationService adminAuthorizationService) {
        this.periodConfigService = periodConfigService;
        this.adminAuthorizationService = adminAuthorizationService;
    }

    @GetMapping
    public ApiResponse<List<PeriodConfig>> list() {
        return ApiResponse.success(periodConfigService.list());
    }

    @PutMapping
    public ApiResponse<List<PeriodConfig>> update(@Valid @RequestBody PeriodConfigRequest request) {
        String apiKey = RequestContext.getApiKey();
        adminAuthorizationService.requireAdmin(apiKey);
        return ApiResponse.success(periodConfigService.update(request, apiKey));
    }
}
