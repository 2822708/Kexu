package com.timetable.service;

import com.timetable.dto.DailyPlanDto;

import java.time.LocalDate;

/**
 * AI 每日计划（AI Campus Agent V1.0 Step 6）。
 *
 * 生成即缓存：同一账号同一天只调一次模型，二次请求命中缓存（省 token 且首页展示稳定）。
 */
public interface DailyPlanService {

    /** 读取已生成的计划；未生成返回 null（不触发生成，首页加载永不烧 token）。 */
    DailyPlanDto get(String apiKey, LocalDate date);

    /**
     * 生成当日计划：命中缓存直接返回；否则一次性生成 → 服务端校验 → 落库。
     *
     * @param scheduleId 目标课表；为 null 时取当前账号第一个课表
     */
    DailyPlanDto generate(String apiKey, Long scheduleId, LocalDate date);
}
