package com.timetable.service;

import com.timetable.config.LlmPricingProperties;
import com.timetable.dto.UsageStatsDto;
import com.timetable.entity.LlmUsage;
import com.timetable.mapper.LlmUsageMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 缓存命中的计价与命中率（成本治理 6.1 #4）。
 *
 * <p>这组测试守的是两个「不报错的错」：
 * <ol>
 *   <li><b>把 null 当 0</b>：不支持缓存的 provider 会被摊进分母，看板上显示命中率 0%，
 *       像是缓存配置写错了，实际是根本没机会命中；</li>
 *   <li><b>缓存价没生效</b>：命中价配了但代码仍按普通价算，成本虚高，
 *       用户会以为「缓存白做了」而关掉它。</li>
 * </ol>
 * 两者在功能上都完全正常，只有对着数字才能发现。
 */
@SpringBootTest(classes = com.timetable.TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:cache_stats;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN",
        // 刻意把缓存价配成普通价的 1/10，好让「有没有走缓存价」一眼可算
        "app.llm.pricing.per-million.input=10.0",
        "app.llm.pricing.per-million.output=20.0",
        "app.llm.pricing.per-million.cached-input=1.0"
})
@ActiveProfiles("standalone")
@AutoConfigureMockMvc
class CachePricingStatsTest {

    private static final String ME = "device_" + "k".repeat(43);
    private static final Path TEST_DATA_DIR = Path.of(System.getProperty("java.io.tmpdir"),
            "tangent-cache-stats-" + UUID.randomUUID());

    @DynamicPropertySource
    static void isolatedSettings(DynamicPropertyRegistry properties) {
        properties.add("app.data-dir", () -> TEST_DATA_DIR.toString());
    }

    @Autowired LlmUsageMapper usageMapper;
    @Autowired UsageStatsService statsService;
    @Autowired LlmPricingProperties pricing;
    @Autowired JdbcTemplate sql;
    @Autowired MockMvc mvc;
    @MockBean LlmClient provider;

    @BeforeEach
    void clean() throws Exception {
        sql.update("DELETE FROM llm_usage");
        sql.update("DELETE FROM api_key");
        mvc.perform(post("/api/auth/device").contentType("application/json")
                .content("{\"deviceKey\":\"" + ME + "\"}")).andExpect(status().isOk());
    }

    @Test
    void cachedInputIsPricedAtCachedRate() {
        // 100 万输入 token 全部命中：按缓存价 1 元，而不是普通价 10 元
        insert(1_000_000, 0, 1_000_000, 0);

        UsageStatsDto dto = statsService.usage(30, ME);

        assertThat(dto.getEstimatedCost())
                .as("命中价没生效：应当用 cached-input=1.0 而不是 input=10.0")
                .isEqualTo(1.0);
        assertThat(dto.getCacheHitRate()).isEqualTo(1.0);
        assertThat(dto.getCacheSavedCny())
                .as("省下的应是 (10-1) 元")
                .isEqualTo(9.0);
    }

    @Test
    void mixedHitAndMissIsPricedSeparately() {
        // 50 万命中(0.5 元) + 50 万未命中(5 元) + 输出 0
        insert(1_000_000, 0, 500_000, 500_000);

        UsageStatsDto dto = statsService.usage(30, ME);

        assertThat(dto.getEstimatedCost()).isEqualTo(5.5);
        assertThat(dto.getCacheHitRate()).isEqualTo(0.5);
        assertThat(dto.getCacheSavedCny()).isEqualTo(4.5);
    }

    @Test
    void unsupportedProviderIsExcludedFromHitRate() {
        // 一条支持缓存且命中了，一条上游根本没报缓存字段
        insert(1_000_000, 0, 1_000_000, 0);
        insert(1_000_000, 0, null, null);

        UsageStatsDto dto = statsService.usage(30, ME);

        assertThat(dto.getCacheHitRate())
                .as("不支持缓存的 provider 不该进分母；把 null 当 0 会把命中率摊薄成 50%%")
                .isEqualTo(1.0);
        assertThat(dto.getCacheHitTokens()).isEqualTo(1_000_000);
    }

    @Test
    void noProviderReportsCacheFieldsYieldsNullRateNotZero() {
        insert(1_000_000, 0, null, null);

        UsageStatsDto dto = statsService.usage(30, ME);

        assertThat(dto.getCacheHitRate())
                .as("全都不支持缓存时应当是 null（无从判断），不是 0%%（看着像配错了）")
                .isNull();
        assertThat(dto.getEstimatedCost())
                .as("没报缓存字段就整段按普通输入价算，不假设有折扣")
                .isEqualTo(10.0);
        assertThat(dto.getCacheSavedCny()).isZero();
    }

    @Test
    void explicitZeroHitStillCountsInDenominator() {
        // 上游明确报 0 命中：这是真的「有机会但没中」，必须进分母
        insert(1_000_000, 0, 0, 1_000_000);

        UsageStatsDto dto = statsService.usage(30, ME);

        assertThat(dto.getCacheHitRate())
                .as("上游明确报 0 命中时应当是 0.0（真的有算），而不是 null")
                .isEqualTo(0.0);
        assertThat(dto.getEstimatedCost()).isEqualTo(10.0);
    }

    @Test
    void cachedPriceDefaultsToPlainInputWhenNotConfigured() {
        // 没配 cached-input 时不能假设折扣，否则会算出一份「看起来省了钱」的假账单
        LlmPricingProperties.PerMillion rate = new LlmPricingProperties.PerMillion(10.0, 20.0);

        assertThat(rate.effectiveCachedInput())
                .as("未配缓存价必须回退普通输入价，不能默认成 0")
                .isEqualTo(10.0);
    }

    /**
     * yml 层面的陷阱：models 下若写了带默认值的占位符（{@code ${X:0.5}}），
     * 等于「显式配了 0.5」，会挡住对全局值的继承。
     *
     * <p>实测踩过：全局 LLM_PRICE_INPUT=10，但 models.deepseek-flash.input 写成
     * {@code ${LLM_PRICE_INPUT_DEEPSEEK_FLASH:0.5}}，结果按 0.5 算，
     * 看板成本显示成实际值的 1/20。这个测试用真实 yml 断言「空占位符不产生覆盖项」。
     */
    @Test
    void emptyPlaceholderModelEntryDoesNotShadowGlobalPrice() {
        // 本测试的 properties 没配 LLM_PRICE_INPUT_DEEPSEEK_FLASH，
        // yml 里那一行是 ${...:} 空默认 → 整条模型条目应被省略 → forModel 走全局价
        LlmPricingProperties.PerMillion resolved = pricing.forModel("deepseek-flash");

        assertThat(resolved.getInput())
                .as("模型条目用了空占位符，不该产生 0.5 之类的假覆盖，必须取全局 input=10.0")
                .isEqualTo(10.0);
        assertThat(resolved.getOutput()).isEqualTo(20.0);
        assertThat(resolved.effectiveCachedInput()).isEqualTo(1.0);
    }

    @Test
    void modelOverrideInheritsFieldsItDidNotConfigure() {
        // 端到端实测过的真实缺陷：覆盖项只写了 output，input 没写。
        // 原来的 PerMillion.input 默认 0.0 而非 null，「有没有配」的判断永远为真，
        // 于是全局 input 被静默丢弃 —— 成本显示成实际的一小部分，且不报任何错。
        LlmPricingProperties props = new LlmPricingProperties();
        props.setPerMillion(new LlmPricingProperties.PerMillion(10.0, 20.0));
        Map<String, LlmPricingProperties.PerMillion> models = new HashMap<>();
        LlmPricingProperties.PerMillion partial = new LlmPricingProperties.PerMillion();
        partial.setOutput(2.0);   // 只配 output，input 留空
        models.put("flash", partial);
        props.setModels(models);

        LlmPricingProperties.PerMillion resolved = props.forModel("flash");

        assertThat(resolved.getInput())
                .as("没配的 input 必须继承全局 10.0，不能被当成 0")
                .isEqualTo(10.0);
        assertThat(resolved.getOutput()).isEqualTo(2.0);
    }

    @Test
    void unconfiguredPriceIsZeroNotFail() {
        // 全都没配时视为 0（免费），计价不 NPE。宁可少算也不能让看板崩掉。
        LlmPricingProperties.PerMillion empty = new LlmPricingProperties.PerMillion();
        assertThat(empty.getInput()).isZero();
        assertThat(empty.getOutput()).isZero();
        assertThat(empty.effectiveCachedInput()).isZero();
    }

    @Test
    void modelOverrideInheritsGlobalCachedPrice() {
        // 真实踩过的坑：全局配了 cached-input，但 models 里有同名覆盖项时，
        // 原实现整对象替换 → 覆盖项没有 cachedInput → 回退到它的 input → 缓存价静默失效。
        // 端到端表现是「配了缓存价但看板显示省了 0 元」，不报任何错。
        LlmPricingProperties props = new LlmPricingProperties();
        LlmPricingProperties.PerMillion global = new LlmPricingProperties.PerMillion(10.0, 20.0);
        global.setCachedInput(1.0);
        props.setPerMillion(global);
        Map<String, LlmPricingProperties.PerMillion> models = new HashMap<>();
        // 覆盖项只配了 input/output，没配 cached-input
        models.put("flash", new LlmPricingProperties.PerMillion(0.5, 2.0));
        props.setModels(models);

        LlmPricingProperties.PerMillion resolved = props.forModel("flash");

        assertThat(resolved.getInput()).as("模型自己的 input 优先").isEqualTo(0.5);
        assertThat(resolved.getOutput()).isEqualTo(2.0);
        assertThat(resolved.effectiveCachedInput())
                .as("覆盖项没配缓存价时，必须继承全局 cached-input=1.0，而不是回退到自己的 input")
                .isEqualTo(1.0);
    }

    @Test
    void modelOverrideCanStillOverrideCachedPrice() {
        LlmPricingProperties props = new LlmPricingProperties();
        LlmPricingProperties.PerMillion global = new LlmPricingProperties.PerMillion(10.0, 20.0);
        global.setCachedInput(1.0);
        props.setPerMillion(global);
        Map<String, LlmPricingProperties.PerMillion> models = new HashMap<>();
        LlmPricingProperties.PerMillion flash = new LlmPricingProperties.PerMillion(0.5, 2.0);
        flash.setCachedInput(0.05);
        models.put("flash", flash);
        props.setModels(models);

        assertThat(props.forModel("flash").effectiveCachedInput())
                .as("模型显式配了缓存价就以模型为准")
                .isEqualTo(0.05);
    }

    @Test
    void pricingIsOverridableByModel() {
        Map<String, LlmPricingProperties.PerMillion> models = new HashMap<>();
        LlmPricingProperties.PerMillion flash = new LlmPricingProperties.PerMillion(1.0, 2.0);
        flash.setCachedInput(0.1);
        models.put("flash", flash);
        pricing.setModels(models);
        try {
            assertThat(pricing.forModel("flash").effectiveCachedInput()).isEqualTo(0.1);
            assertThat(pricing.forModel("unknown").effectiveCachedInput())
                    .as("未命中的模型走全局默认缓存价")
                    .isEqualTo(1.0);
        } finally {
            pricing.setModels(new HashMap<>());
        }
    }

    private void insert(int promptTokens, int completionTokens, Integer hit, Integer miss) {
        LlmUsage usage = new LlmUsage();
        usage.setApiKey(ME);
        usage.setScene(LlmUsage.SCENE_CHAT);
        usage.setProvider("deepseek");
        usage.setModel("deepseek-flash");
        usage.setPromptTokens(promptTokens);
        usage.setCompletionTokens(completionTokens);
        usage.setTotalTokens(promptTokens + completionTokens);
        usage.setStream(false);
        usage.setLatencyMs(100);
        usage.setStatus(LlmUsage.STATUS_SUCCESS);
        usage.setCacheHitTokens(hit);
        usage.setCacheMissTokens(miss);
        usage.setCreatedAt(LocalDateTime.now().minusMinutes(1));
        usageMapper.insert(usage);
    }

    /** 保证 schema 真带上了 V7 加的两列——迁移写错时这里会最先炸。 */
    @Test
    void schemaHasCacheColumns() {
        Integer count = sql.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'llm_usage'"
                        + " AND column_name IN ('cache_hit_tokens', 'cache_miss_tokens')", Integer.class);
        assertThat(count).as("V7 迁移未生效，llm_usage 缺少缓存命中两列").isEqualTo(2);
    }

    /** 时间戳列能正常写入（防止 TIMESTAMP 方言差异导致插入静默失败）。 */
    @Test
    void createdAtRoundTrips() {
        insert(10, 5, 3, 7);
        Timestamp ts = sql.queryForObject("SELECT created_at FROM llm_usage", Timestamp.class);
        assertThat(ts).isNotNull();
    }
}
