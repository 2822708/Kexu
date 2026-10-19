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
     *
     * <p><b>字段级合并，不是整个对象替换</b>：模型覆盖项只配了 input/output、
     * 没配 cached-input 时，cached-input 要从通用默认继承。原来的实现是「整对象返回」，
     * 于是 models 里只要有一项存在，per-million 下新加的字段就<b>静默全部失效</b>——
     * 实测踩过：全局配了 LLM_PRICE_CACHED_INPUT=1，但因为 models.deepseek-flash
     * 存在，命中价仍按 0.5 算，看板上「省了 0 元」。
     * 新加单价格字段时必须记住这一点。
     */
    public PerMillion forModel(String modelName) {
        PerMillion override = (modelName != null && !modelName.isBlank())
                ? models.get(modelName) : null;
        if (override == null) {
            return perMillion;
        }
        // 必须用 raw*：getInput() 会把 null 兜底成 0.0，拿它判断「有没有配」永远为真，
        // 结果就是覆盖项里没写的字段被当成 0，全局价静默失效。
        PerMillion merged = new PerMillion(
                override.rawInput() == null ? perMillion.getInput() : override.rawInput(),
                override.rawOutput() == null ? perMillion.getOutput() : override.rawOutput());
        merged.setCachedInput(override.getCachedInput() == null
                ? perMillion.getCachedInput() : override.getCachedInput());
        return merged;
    }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public PerMillion getPerMillion() { return perMillion; }
    public void setPerMillion(PerMillion perMillion) { this.perMillion = perMillion; }
    public Map<String, PerMillion> getModels() { return models; }
    public void setModels(Map<String, PerMillion> models) { this.models = models; }

    /** 单价，单位「元 / 百万 token」。 */
    public static class PerMillion {
        /*
         * 默认 null 而不是 0.0：null = 这一项没配（可从全局继承），0.0 = 明确免费。
         * 用 0.0 当初值会让「覆盖项没配 input、应继承全局价」这个判断永远不成立。
         * 实测踩过：全局配 LLM_PRICE_INPUT=10，但 models.deepseek-flash 存在，
         * 它的 input 字段默认 0.0 非 null → 判定「已配」→ 全局价静默丢弃，
         * 成本显示成实际值的 1/20，而看板不会报任何错。
         */
        private Double input;
        private Double output;
        /**
         * 命中前缀缓存的输入单价（成本治理 6.1 #4）。
         *
         * <p><b>默认留空而不是填 0</b>：填 0 等于宣称「缓存命中不要钱」，会把成本算低。
         * 未配置时回退到 {@link #input}，即「不算缓存折扣」——宁可算贵一点，
         * 也不能给出一份看起来省了钱、实际超支的账单。要便宜就得显式填真实缓存价。
         */
        private Double cachedInput;

        public PerMillion() {
        }

        public PerMillion(Double input, Double output) {
            this.input = input;
            this.output = output;
        }

        /** 空安全：未配置视为 0（免费），计价时不会 NPE。区分「没配」请用 {@link #rawInput()}。 */
        public Double getInput() { return input == null ? 0.0 : input; }
        public void setInput(Double input) { this.input = input; }
        public Double getOutput() { return output == null ? 0.0 : output; }
        public void setOutput(Double output) { this.output = output; }

        /** 原始值，null 表示「这一项没配」。合并逻辑用它判断该不该继承。 */
        public Double rawInput() { return input; }
        public Double rawOutput() { return output; }
        public Double getCachedInput() { return cachedInput; }
        public void setCachedInput(Double cachedInput) { this.cachedInput = cachedInput; }

        /** 实际生效的缓存输入价：未配置时退回普通输入价（不假设折扣）。 */
        public Double effectiveCachedInput() {
            return cachedInput == null ? getInput() : cachedInput;
        }
    }
}