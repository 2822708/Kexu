package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 每日计划缓存（AI Campus Agent V1.0）。一天一条，重复生成命中缓存，避免重复消耗 token。
 */
@TableName(value = "daily_plan")
public class DailyPlan {

    @TableId(type = IdType.AUTO)
    private Long id;
    /**
     * 凭据本身，绝不返回给前端。
     *
     * <p>同项目的其它实体（Task/AiEvent/ApiKey 等）都标了 @JsonIgnore，这里属于遗漏补齐。
     * 泄露的后果不是「别人能看到」，而是**它会被写进浏览器缓存、日志、截图、
     * 以及任何一次「把接口响应贴给别人看」** —— 那等于把整个工作区的钥匙递出去。
     */
    @JsonIgnore
    private String apiKey;
    private LocalDate planDate;
    /** 时间线 JSON：{"items":[{start,end,type,title,refId,note}],...} */
    private String content;
    private String summary;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public LocalDate getPlanDate() { return planDate; }
    public void setPlanDate(LocalDate planDate) { this.planDate = planDate; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
