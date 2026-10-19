package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;

/**
 * 一次 LLM 调用的用量与成本记录（成本治理 P0-1）。
 *
 * <p>这是「成本治理」的基础数据：没有 token 计量，多 provider 路由、分级路由、
 * Prompt Caching、预算熔断全都无从谈起。调用点集中在
 * {@code DeepSeekLlmClient}，因此新增 provider 时只要实现
 * {@code LlmClient}并沿用埋点约定即可，无需改动业务层。
 *
 * <p><b>失败也记录</b>：token 已经花掉但解析失败是真实成本，只记成功会系统性低估。
 * {@code status} 区分 SUCCESS / ERROR，ERROR 时 token 数取已知部分。
 */
@TableName("llm_usage")
public class LlmUsage {
    /** 埋点场景：CHAT / EXTRACT / INBOX / PLAN / REFINE / PARSE_HTML / OCR / QUERY / UNKNOWN。 */
    public static final String SCENE_CHAT = "CHAT";
    public static final String SCENE_EXTRACT = "EXTRACT";
    /** 通知箱提炼（今日待阅）。与 EXTRACT 分开统计：两者的 prompt 与输出形态都不同。 */
    public static final String SCENE_INBOX = "INBOX";
    public static final String SCENE_PLAN = "PLAN";
    public static final String SCENE_REFINE = "REFINE";
    public static final String SCENE_PARSE_HTML = "PARSE_HTML";
    public static final String SCENE_OCR = "OCR";
    /** 查询计划整理（信息处理页查询中心）。不检索外部渠道，只生成结构化计划。 */
    public static final String SCENE_QUERY = "QUERY";
    public static final String SCENE_UNKNOWN = "UNKNOWN";

    public static final String STATUS_SUCCESS = "SUCCESS";
    public static final String STATUS_ERROR = "ERROR";

    @TableId(type = IdType.AUTO)
    private Long id;
    @JsonIgnore
    private String apiKey;
    private String scene;
    private String provider;
    private String model;
    private Integer promptTokens;
    private Integer completionTokens;
    private Integer totalTokens;
    private Boolean stream;
    private Integer latencyMs;
    private String status;
    /**
     * 输入中命中前缀缓存的 token 数（成本治理 6.1 #4）。
     *
     * <p><b>null 与 0 是两件事</b>：null = 上游没报这个字段（该 provider 不支持缓存），
     * 0 = 上游报了，但这次一个都没命中。合成 0 会让「刚接入的 provider」被算成命中率 0%，
     * 看着像缓存失效，实际是从未有机会命中。统计侧据此决定要不要把它算进分母。
     */
    private Integer cacheHitTokens;
    /** 输入中未命中缓存的 token 数。语义同上，null 表示上游未报。 */
    private Integer cacheMissTokens;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getScene() { return scene; }
    public void setScene(String scene) { this.scene = scene; }
    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }
    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }
    public Integer getPromptTokens() { return promptTokens; }
    public void setPromptTokens(Integer promptTokens) { this.promptTokens = promptTokens; }
    public Integer getCompletionTokens() { return completionTokens; }
    public void setCompletionTokens(Integer completionTokens) { this.completionTokens = completionTokens; }
    public Integer getTotalTokens() { return totalTokens; }
    public void setTotalTokens(Integer totalTokens) { this.totalTokens = totalTokens; }
    public Boolean getStream() { return stream; }
    public void setStream(Boolean stream) { this.stream = stream; }
    public Integer getLatencyMs() { return latencyMs; }
    public void setLatencyMs(Integer latencyMs) { this.latencyMs = latencyMs; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public Integer getCacheHitTokens() { return cacheHitTokens; }
    public void setCacheHitTokens(Integer cacheHitTokens) { this.cacheHitTokens = cacheHitTokens; }
    public Integer getCacheMissTokens() { return cacheMissTokens; }
    public void setCacheMissTokens(Integer cacheMissTokens) { this.cacheMissTokens = cacheMissTokens; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}