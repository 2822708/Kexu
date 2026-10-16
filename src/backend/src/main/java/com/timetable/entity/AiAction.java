package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

@TableName("ai_action")
public class AiAction {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long messageId;
    @JsonIgnore
    private String apiKey;
    private String scope;
    private Long scheduleId;
    private String actionType;
    private String actionStatus;
    private String actionData;
    private String dataFingerprint;
    private Integer sortOrder;
    private LocalDateTime createdAt;
    /**
     * 用户作出决定（确认执行 / 拒绝）的时刻。
     *
     * 原来只有 {@code createdAt}，EXECUTED / REJECTED 的发生时刻完全丢失，
     * 算不出提案确认率的时序变化，也算不出「生成 → 确认」耗时。
     *
     * 写入时机见 AiServiceImpl：executeAction 在 applyAction 成功后写（同事务，
     * 失败回滚不留假记录），rejectAction 与状态变更合并进同一条 CAS。
     * 注意 STALE 的只读展示态复核仍不落库（既有设计），所以本列只覆盖已落库决定。
     */
    private LocalDateTime decidedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getMessageId() { return messageId; }
    public void setMessageId(Long messageId) { this.messageId = messageId; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }
    public Long getScheduleId() { return scheduleId; }
    public void setScheduleId(Long scheduleId) { this.scheduleId = scheduleId; }
    public String getActionType() { return actionType; }
    public void setActionType(String actionType) { this.actionType = actionType; }
    public String getActionStatus() { return actionStatus; }
    public void setActionStatus(String actionStatus) { this.actionStatus = actionStatus; }
    public String getActionData() { return actionData; }
    public void setActionData(String actionData) { this.actionData = actionData; }
    public String getDataFingerprint() { return dataFingerprint; }
    public void setDataFingerprint(String dataFingerprint) { this.dataFingerprint = dataFingerprint; }
    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getDecidedAt() { return decidedAt; }
    public void setDecidedAt(LocalDateTime decidedAt) { this.decidedAt = decidedAt; }
}
