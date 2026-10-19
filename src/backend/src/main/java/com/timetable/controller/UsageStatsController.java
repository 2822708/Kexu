package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.ProductHealthDto;
import com.timetable.dto.ProposalFunnelDto;
import com.timetable.dto.UsageStatsDto;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.ProductHealthService;
import com.timetable.service.UsageStatsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 成本度量端点（成本治理 P0-1）。
 *
 * <p>鉴权由 {@code ApiKeyInterceptor} 在路由前完成，这里直接取
 * {@link RequestContext#getApiKey()} 作为身份下推到 service——<b>不接受前端传 key</b>。
 */
@RestController
@RequestMapping("/api/stats")
public class UsageStatsController {

    private final UsageStatsService usageStatsService;
    private final ProductHealthService productHealthService;

    public UsageStatsController(UsageStatsService usageStatsService,
                                ProductHealthService productHealthService) {
        this.usageStatsService = usageStatsService;
        this.productHealthService = productHealthService;
    }

    /** LLM 用量与估算成本。days 为窗口天数，默认 30，上限 365。 */
    @GetMapping("/usage")
    public ApiResponse<UsageStatsDto> usage(@RequestParam(required = false) Integer days) {
        return ApiResponse.success(usageStatsService.usage(days, RequestContext.getApiKey()));
    }

    /** 提案漏斗：确认率、平均确认耗时。 */
    @GetMapping("/proposals")
    public ApiResponse<ProposalFunnelDto> proposals() {
        return ApiResponse.success(usageStatsService.proposals(RequestContext.getApiKey()));
    }

    /**
     * 产品健康度：每日计划采纳率 + 7 日留存（成本治理 6.1 #1）。
     *
     * <p>「功能有没有用」和「花了多少钱」是两个问题，所以单独一个端点，
     * 不塞进 /usage 里让人误以为它是成本指标。
     */
    @GetMapping("/health")
    public ApiResponse<ProductHealthDto> health() {
        return ApiResponse.success(productHealthService.forUser(RequestContext.getApiKey()));
    }
}