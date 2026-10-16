package com.timetable.service;

import com.timetable.dto.ProposalFunnelDto;
import com.timetable.dto.UsageStatsDto;

/**
 * 用量与提案漏斗统计（成本治理 P0-1）。
 *
 * <p>实现里每个查询都以 {@code apiKey} 为过滤条件——这是单用户数据模型下
 * 防止越权读取的唯一手段，不可省略。
 */
public interface UsageStatsService {

    /** LLM 用量汇总；days 为统计窗口天数，传 null 用默认 30。 */
    UsageStatsDto usage(Integer days, String apiKey);

    /** 提案漏斗：确认率与「生成 → 确认」平均耗时。 */
    ProposalFunnelDto proposals(String apiKey);
}