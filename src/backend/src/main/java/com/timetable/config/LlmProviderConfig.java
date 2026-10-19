package com.timetable.config;

/**
 * 一个 OpenAI 兼容 provider 的连接参数（成本治理 6.1：多 provider）。
 *
 * <p>智谱 GLM、通义千问、豆包、 moonshot 以及任何自建的 OpenAI 兼容网关，
 * 协议都是同一套 chat/completions，差别只有这里这几个字段。所以不写死厂商名，
 * 全部走配置：用户想接哪家就在 {@code app.llm.providers.<id>} 下填这几个值。
 *
 * <p>Key 留空 = 该 provider 未配置，不参与激活与降级（避免「配了 baseUrl 但没 Key」
 * 的半吊子配置把正常链路拖下水）。
 */
public class LlmProviderConfig {

    /** chat/completions 根地址，如 https://open.bigmodel.cn/api/paas/v4 */
    private String baseUrl = "";
    private String model = "";
    private String apiKey = "";
    private int timeoutSeconds = 120;
    /** SSE 必须持续有进展；上游沉默就直接断开，避免一直占着工作线程 */
    private int idleTimeoutSeconds = 30;
    private int maxTokens = 8192;
    private double temperature = 0.2;
    /** 推理强度（low/medium/high）。多数兼容服务不支持，留空则不下发该字段 */
    private String reasoningEffort = "";

    public String getBaseUrl() { return baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }

    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public int getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }

    public int getIdleTimeoutSeconds() { return idleTimeoutSeconds; }
    public void setIdleTimeoutSeconds(int idleTimeoutSeconds) { this.idleTimeoutSeconds = idleTimeoutSeconds; }

    public int getMaxTokens() { return maxTokens; }
    public void setMaxTokens(int maxTokens) { this.maxTokens = maxTokens; }

    public double getTemperature() { return temperature; }
    public void setTemperature(double temperature) { this.temperature = temperature; }

    public String getReasoningEffort() { return reasoningEffort; }
    public void setReasoningEffort(String reasoningEffort) { this.reasoningEffort = reasoningEffort; }

    /** 是否填全了调用所需的最小信息（地址 + 模型 + Key）。 */
    public boolean isComplete() {
        return baseUrl != null && !baseUrl.isBlank()
                && model != null && !model.isBlank()
                && apiKey != null && !apiKey.isBlank();
    }
}
