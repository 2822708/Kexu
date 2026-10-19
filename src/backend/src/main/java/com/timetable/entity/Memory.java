package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

/**
 * 长期记忆（AI Campus Agent V1.0）。只存从对话中提炼的跨天有效事实，
 * 与 ai_message（原始聊天流水）严格分离。
 */
@TableName(value = "student_memory")
public class Memory {

    public static final String TYPE_GOAL = "GOAL";
    public static final String TYPE_INTEREST = "INTEREST";
    public static final String TYPE_ABILITY = "ABILITY";
    public static final String TYPE_HABIT = "HABIT";
    public static final String TYPE_PREFERENCE = "PREFERENCE";

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_SUPERSEDED = "SUPERSEDED";

    public static final String SOURCE_AI = "AI";
    public static final String SOURCE_USER = "USER";

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
    private String type;
    private String content;
    private Integer importance;
    private String status;
    private String source;
    /** 产生该记忆的对话/消息 id，便于审计。 */
    private String sourceRef;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public Integer getImportance() { return importance; }
    public void setImportance(Integer importance) { this.importance = importance; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getSourceRef() { return sourceRef; }
    public void setSourceRef(String sourceRef) { this.sourceRef = sourceRef; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
