package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

/**
 * 用户行为事件（成本治理 P0-1）。
 *
 * <p>通用事件表：先落提案确认 / 拒绝两种事件，后续要加留存、计划采纳率等指标时
 * 只需补写事件，<b>不需要再改表结构</b>。
 *
 * <p>刻意不引第三方采集 SDK——当前场景数有限，手工埋点可读、可测、零体积开销。
 */
@TableName("ai_event")
public class AiEvent {
    /** 用户确认执行了一条 AI 提案。 */
    public static final String TYPE_PROPOSAL_CONFIRMED = "PROPOSAL_CONFIRMED";
    /** 用户拒绝了一条 AI 提案。 */
    public static final String TYPE_PROPOSAL_REJECTED = "PROPOSAL_REJECTED";

    @TableId(type = IdType.AUTO)
    private Long id;
    @JsonIgnore
    private String apiKey;
    private String eventType;
    private String scene;
    private String actionType;
    private Long refId;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getEventType() { return eventType; }
    public void setEventType(String eventType) { this.eventType = eventType; }
    public String getScene() { return scene; }
    public void setScene(String scene) { this.scene = scene; }
    public String getActionType() { return actionType; }
    public void setActionType(String actionType) { this.actionType = actionType; }
    public Long getRefId() { return refId; }
    public void setRefId(Long refId) { this.refId = refId; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}