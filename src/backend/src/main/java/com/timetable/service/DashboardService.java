package com.timetable.service;

import com.timetable.dto.DashboardDto;

import java.time.LocalDate;

/**
 * AI Dashboard 聚合服务（AI Campus Agent V1.0 Step 5）。
 *
 * 一次请求返回首页全部数据：档案 + 今日课程 + 今日任务 + 48h 截止 + 考试倒计时
 * + 规则计算的今日重点。「今日重点」是确定性规则（逾期/48h/考试倒计时），
 * 不调用模型，保证同一数据下结果稳定；AI 每日计划摘要在 Step 6 接入。
 */
public interface DashboardService {

    /**
     * @param date       查询日期（null = 今天，服务端时钟）
     * @param scheduleId 课表 id（null = 用户最近创建的课表；无课表时课程/考试为空）
     */
    DashboardDto dashboard(LocalDate date, Long scheduleId, String apiKey);
}
