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

    /**
     * 每日计划生成成功（真的调了模型、落了库）。
     *
     * <p>缓存命中<b>不算</b>：那不是一次新的「让学长排一天」，用户也没花 token。
     * 把它算进分母会把采纳率拉低——用户看同一份计划十次，难道算十次没采用？
     */
    public static final String TYPE_PLAN_GENERATED = "PLAN_GENERATED";
    /**
     * 每日计划被采用：计划里安排的任务，当天真的被推进/完成了。
     *
     * <p>{@code refId} = {@code daily_plan.id}。只在「本计划是该用户该日最好一份」时落一次，
     * 见 {@code DailyPlanAdoptionService} 的去重说明。
     */
    public static final String TYPE_PLAN_ADOPTED = "PLAN_ADOPTED";
    /** 登录/使用活跃（任一需要鉴权的请求即可，按天去重）。用于 7 日留存。 */
    public static final String TYPE_APP_ACTIVE = "APP_ACTIVE";

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