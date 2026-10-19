package com.timetable.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 上游 usage 里缓存字段的解析（成本治理 6.1 #4）。
 *
 * <p>两家字段名不一样，而且<b>谁也没义务报</b>。这里守住三件事：
 * <ol>
 *   <li>两家的字段都能读到——只认一家等于让另一家的缓存白做，且不会报错；</li>
 *   <li>没报时必须留 null，不能填 0——否则「不支持缓存的 provider」会被算成命中率 0%；</li>
 *   <li>脏数据（命中数大于输入总数）不能让成本算成负数。</li>
 * </ol>
 */
class LlmCacheUsageParsingTest {

    private final ObjectMapper mapper = new ObjectMapper();

    /** 暴露 protected 的 Usage 供测试直接驱动，不必起 HTTP。 */
    private static final class Probe extends AbstractOpenAiLlmClient {
        Probe() { super(new ObjectMapper(), null); }
        Usage parse(String json) throws Exception {
            Usage usage = new Usage();
            usage.setFrom(new ObjectMapper().readTree(json).path("usage"));
            return usage;
        }
        @Override public String providerId() { return "probe"; }
        @Override public boolean isConfigured() { return true; }
        @Override protected String baseUrl() { return "http://localhost"; }
        @Override protected String apiKey() { return "k"; }
        @Override protected String model() { return "m"; }
        @Override protected double temperature() { return 0.2; }
        @Override protected int maxTokens() { return 100; }
        @Override protected String reasoningEffort() { return null; }
        @Override protected int timeoutSeconds() { return 10; }
        @Override protected int idleTimeoutSeconds() { return 5; }
    }

    private final Probe probe = new Probe();

    @Test
    void readsDeepSeekCacheFields() throws Exception {
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":1000,\"completion_tokens\":50,"
                        + "\"prompt_cache_hit_tokens\":768,\"prompt_cache_miss_tokens\":232}}");

        assertThat(usage.promptTokens()).isEqualTo(1000);
        assertThat(usage.cacheHitTokens()).isEqualTo(768);
        assertThat(usage.cacheMissTokens()).isEqualTo(232);
    }

    @Test
    void readsOpenAiCachedTokensAndBackfillsMiss() throws Exception {
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":1000,\"completion_tokens\":50,"
                        + "\"prompt_tokens_details\":{\"cached_tokens\":900}}}");

        assertThat(usage.cacheHitTokens())
                .as("OpenAI 只报 cached_tokens，不认这个字段等于 OpenAI 的缓存白做")
                .isEqualTo(900);
        assertThat(usage.cacheMissTokens())
                .as("miss 应由 prompt_tokens - cached 反推")
                .isEqualTo(100);
    }

    @Test
    void leavesNullWhenUpstreamReportsNothing() throws Exception {
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":800,\"completion_tokens\":20}}");

        assertThat(usage.cacheHitTokens())
                .as("没报就是 null，不能变成 0——否则该 provider 会被算成命中率 0%%")
                .isNull();
        assertThat(usage.cacheMissTokens()).isNull();
    }

    @Test
    void keepsZeroWhenUpstreamExplicitlyReportsZeroHit() throws Exception {
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":800,\"completion_tokens\":20,"
                        + "\"prompt_cache_hit_tokens\":0,\"prompt_cache_miss_tokens\":800}}");

        assertThat(usage.cacheHitTokens())
                .as("上游明确报了 0，这与「没报」不同，必须保留 0 以便进入命中率分母")
                .isEqualTo(0);
        assertThat(usage.cacheMissTokens()).isEqualTo(800);
    }

    @Test
    void clampsCachedTokensAbovePromptTokens() throws Exception {
        // 上游脏数据：命中数比输入总数还大。不夹紧会让 miss 变负，成本算出负数。
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10,"
                        + "\"prompt_tokens_details\":{\"cached_tokens\":500}}}");

        assertThat(usage.cacheHitTokens()).isEqualTo(100);
        assertThat(usage.cacheMissTokens()).isEqualTo(0);
    }

    @Test
    void emptyUsageLeavesEverythingNull() throws Exception {
        AbstractOpenAiLlmClient.Usage usage = probe.parse("{\"choices\":[]}");

        assertThat(usage.promptTokens()).isZero();
        assertThat(usage.cacheHitTokens()).isNull();
        assertThat(usage.cacheMissTokens()).isNull();
    }

    @Test
    void deepSeekShapeWinsOverOpenAiShapeWhenBothPresent() throws Exception {
        // 某些聚合网关会把两家字段都吐出来。DeepSeek 的值是上游按实际算的，
        // 优先级高于本地反推，必须用它。
        AbstractOpenAiLlmClient.Usage usage = probe.parse(
                "{\"usage\":{\"prompt_tokens\":1000,\"completion_tokens\":50,"
                        + "\"prompt_cache_hit_tokens\":600,\"prompt_cache_miss_tokens\":400,"
                        + "\"prompt_tokens_details\":{\"cached_tokens\":900}}}");

        assertThat(usage.cacheHitTokens()).isEqualTo(600);
        assertThat(usage.cacheMissTokens()).isEqualTo(400);
    }

    /** 保证 mapper 字段不被优化掉：本类只用它构造 JSON，这里显式断言一下。 */
    @Test
    void mapperIsUsable() throws Exception {
        JsonNode node = mapper.readTree("{\"a\":1}");
        assertThat(node.path("a").asInt()).isEqualTo(1);
    }
}
