package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

/**
 * 任务（AI Campus Agent V1.0）。与 todo 并存：todo 保持原状，
 * 本表承载类型/优先级/状态机/来源，是 AI 任务抽取提案的写入对象。
 */
@TableName(value = "task")
public class Task {

    public static final String TYPE_COURSE_WORK = "COURSE_WORK";
    public static final String TYPE_LAB_REPORT = "LAB_REPORT";
    public static final String TYPE_ONLINE_COURSE = "ONLINE_COURSE";
    public static final String TYPE_EXAM = "EXAM";
    public static final String TYPE_COMPETITION = "COMPETITION";
    public static final String TYPE_OTHER = "OTHER";

    public static final int PRIORITY_HIGH = 1;
    public static final int PRIORITY_MEDIUM = 2;
    public static final int PRIORITY_LOW = 3;

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_IN_PROGRESS = "IN_PROGRESS";
    public static final String STATUS_DONE = "DONE";
    public static final String STATUS_CANCELLED = "CANCELLED";

    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String SOURCE_AI_PARSE = "AI_PARSE";
    public static final String SOURCE_AI_PLAN = "AI_PLAN";
    public static final String SOURCE_LEGACY_TODO = "LEGACY_TODO";

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
    private String title;
    private String type;
    private String description;
    private LocalDateTime deadline;
    private Integer priority;
    private String status;
    private String source;
    /** 来源凭证：LEGACY_TODO 为 'todo:{id}'，AI_PARSE 为消息 id 等。 */
    private String sourceRef;
    private Long scheduleId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public LocalDateTime getDeadline() { return deadline; }
    public void setDeadline(LocalDateTime deadline) { this.deadline = deadline; }

    public Integer getPriority() { return priority; }
    public void setPriority(Integer priority) { this.priority = priority; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getSourceRef() { return sourceRef; }
    public void setSourceRef(String sourceRef) { this.sourceRef = sourceRef; }

    public Long getScheduleId() { return scheduleId; }
    public void setScheduleId(Long scheduleId) { this.scheduleId = scheduleId; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
