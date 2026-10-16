package com.timetable.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * LLM 单价配置（成本治理 P0-1）。
 *
 * <p><b>刻意做成配置而不是硬编码</b>：模型价格一定会变，硬编码的金额会静默过期，
 * 让统计页显示一个看起来精确、实际错误的成本。价格由使用者按最新价目表覆盖配置，
 * UI 上也标注「估算」。换 provider / 换模型同样只改配置。
 *
 * <p>取价顺序：{@code models.<modelName>} 精确匹配 → {@code perMillion} 通用默认。
 */
@Component
@ConfigurationProperties(prefix = "app.llm.pricing")
public class LlmPricingProperties {

    /** 币种符号，仅用于前端展示。 */
    private String currency = "CNY";

    /** 通用默认单价（元/百万 token）。 */
    private PerMillion perMillion = new PerMillion();

    /** 按模型名覆盖，取值结构与 perMillion 相同。 */
    private Map<String, PerMillion> models = new HashMap<>();

    /**
     * 取某个模型的单价：优先精确匹配，缺失则回退通用默认。
     * modelName 为空时也用默认。
     */
    public PerMillion forModel(String modelName) {
        if (modelName != null && !modelName.isBlank()) {
            PerMillion override = models.get(modelName);
            if (override != null) {
                return override;
            }
        }
        return perMillion;
    }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public PerMillion getPerMillion() { return perMillion; }
    public void setPerMillion(PerMillion perMillion) { this.perMillion = perMillion; }
    public Map<String, PerMillion> getModels() { return models; }
    public void setModels(Map<String, PerMillion> models) { this.models = models; }

    /** 单价，单位「元 / 百万 token」。 */
    public static class PerMillion {
        private Double input = 0.0;
        private Double output = 0.0;

        public PerMillion() {
        }

        public PerMillion(Double input, Double output) {
            this.input = input;
            this.output = output;
        }

        public Double getInput() { return input; }
        public void setInput(Double input) { this.input = input; }
        public Double getOutput() { return output; }
        public void setOutput(Double output) { this.output = output; }
    }
}