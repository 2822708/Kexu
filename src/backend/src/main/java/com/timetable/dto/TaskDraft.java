package com.timetable.dto;

import java.time.LocalDateTime;

/**
 * 任务草稿（AI Campus Agent V1.0）。
 *
 * 抽取产物与手动创建的输入共用同一结构：deadline 为 null 表示未设置
 * （AI 抽取时严禁猜测时间，见 prompts/task-extract.md）。
 */
public class TaskDraft {

    private String title;
    private String type;
    private LocalDateTime deadline;
    private Integer priority;
    private String description;

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public LocalDateTime getDeadline() { return deadline; }
    public void setDeadline(LocalDateTime deadline) { this.deadline = deadline; }

    public Integer getPriority() { return priority; }
    public void setPriority(Integer priority) { this.priority = priority; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
}
