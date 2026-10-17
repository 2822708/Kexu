package com.timetable.dto;

import java.time.LocalDateTime;

/**
 * 待阅通知草稿（AI 提取输出，用户核对后可落库）。
 *
 * <p>与 {@link TaskDraft} 的关键区别：草稿**不代表需要用户去做的事**。
 * 通知里绝大多数是「知道了就行」的信息，只有用户点「加入日程」才变成任务。
 * 因此这里没有 priority / status，取而代之的是 relevance（关联度）。
 */
public class NoticeDraft {

    /** 信息来源，如「学院通知」「图书馆」。 */
    private String source;
    /** 一句话核心 */
    private String title;
    private String summary;
    /** 关键时间；材料没有明确时间就是 null */
    private LocalDateTime keyTime;
    private String requirement;
    /** 关联度 1 高 / 2 中 / 3 低 */
    private Integer relevance;

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public LocalDateTime getKeyTime() { return keyTime; }
    public void setKeyTime(LocalDateTime keyTime) { this.keyTime = keyTime; }

    public String getRequirement() { return requirement; }
    public void setRequirement(String requirement) { this.requirement = requirement; }

    public Integer getRelevance() { return relevance; }
    public void setRelevance(Integer relevance) { this.relevance = relevance; }
}
