package com.timetable.dto;

/**
 * 设置页提交的 provider 配置（成本治理 6.1 #2）。
 *
 * <p>{@code apiKey} 的三态语义很关键：{@code null} = 不改动现有 Key（界面上只显示掩码，
 * 用户只改模型名时不会把 Key 清掉）；空串 = 显式清除；其它 = 覆盖。
 */
public class LlmProviderRequest {

    private String id;
    private String baseUrl;
    private String model;
    private String apiKey;
    private Integer timeoutSeconds;
    private Integer maxTokens;
    private Double temperature;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public Integer getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(Integer timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }

    public Integer getMaxTokens() { return maxTokens; }
    public void setMaxTokens(Integer maxTokens) { this.maxTokens = maxTokens; }

    public Double getTemperature() { return temperature; }
    public void setTemperature(Double temperature) { this.temperature = temperature; }
}
