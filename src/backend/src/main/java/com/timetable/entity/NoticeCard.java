package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

/**
 * 待阅通知卡片（AI Campus Agent · 今日待阅）。
 *
 * <p>信息入口是<strong>手动喂入</strong>：用户把群公告、教务邮件、截图转发或粘贴给助手，
 * AI 提取成「一句话核心 + 关键时间 + 相关要求」的精简卡片，存进这里等用户决定。
 * 原始材料不落库——整段群聊记录既占空间又有隐私负担，且用户真正需要的只是提炼结果。
 *
 * <p>与 task 的关系：卡片本身<strong>不是任务</strong>。用户点「加入日程」才转成 task。
 * 这个区分很重要——通知里有大量「知道了就行」的信息（讲座预告、新书到馆），
 * 把它们全塞进待办列表会让待办区迅速失去信噪比。
 */
@TableName(value = "notice_card")
public class NoticeCard {

    /** 待用户决定（今日待阅的默认态） */
    public static final String STATUS_PENDING = "PENDING";
    /** 用户点了「忽略」：不删数据，保留可追溯 */
    public static final String STATUS_IGNORED = "IGNORED";
    /** 已转成任务：卡片留档，避免同一条通知重复转任务 */
    public static final String STATUS_DONE = "DONE";

    /** 关联度：与本人强相关（专业/年级/已关注事项命中） */
    public static final int RELEVANCE_HIGH = 1;
    /** 关联度：可能相关 */
    public static final int RELEVANCE_MEDIUM = 2;
    /** 关联度：仅泛泛相关 */
    public static final int RELEVANCE_LOW = 3;

    @TableId(type = IdType.AUTO)
    private Long id;
    @JsonIgnore
    private String apiKey;
    /** 信息来源，如「学院通知」「图书馆」「班委通知」。按来源降权的依据。 */
    private String source;
    /** 一句话核心，卡片标题 */
    private String title;
    /** 核心内容展开 */
    private String summary;
    /** 关键时间（截止 / 活动开始）。没有明确时间就是 null，绝不猜。 */
    private LocalDateTime keyTime;
    /** 相关要求（报名条件、加分规则、携带材料等） */
    private String requirement;
    /** 关联度 1/2/3，仅作展示排序用 */
    private Integer relevance;
    private String status;
    /** 「稍后提醒」的到期时刻；为空或已过期才出现在今日待阅列表 */
    private LocalDateTime snoozeUntil;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

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

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public LocalDateTime getSnoozeUntil() { return snoozeUntil; }
    public void setSnoozeUntil(LocalDateTime snoozeUntil) { this.snoozeUntil = snoozeUntil; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
