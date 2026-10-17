package com.timetable.service;

import com.timetable.TimetableApplication;
import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.entity.LlmUsage;
import com.timetable.exception.BusinessException;
import com.timetable.interceptor.RequestContext;
import com.timetable.mapper.LlmUsageMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 月度预算与超限熔断（成本治理 P0-2）。
 *
 * <p>真实应用启动 + 真实迁移 + 真实 Mapper，只把「额度」当变量。单价固定成
 * 1 元 / 百万 token，于是 1 token = 0.000001 元，断言可以直接换算：
 * <ul>
 *   <li>场景额度 CHAT = 0.02 元 → 20,000 token 触顶</li>
 *   <li>全局额度 = 0.05 元 → 50,000 token 触顶</li>
 * </ul>
 *
 * <p><b>这个测试最重要的一条是「只拦该场景」</b>：把额度做成单一总闸会让
 * 「聊天聊嗨了」连带弄挂课表解析，而后者往往更紧急、更不可替代。
 * 那正是 P0-2 明确要求避免的行为。
 *
 * <p>注意：本类用真实系统时钟判定「本月」，所以「上月」的夹具必须用
 * {@code LocalDate.now().withDayOfMonth(1).minusDays(1)} 相对构造，
 * 不能写死日期（参见 HANDOVER 3.6「测试里写死今天的日期字面量」）。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:llm_budget;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN",
        "app.llm.pricing.per-million.input=1.0",
        "app.llm.pricing.per-million.output=1.0",
        // 全局 0.05 元，CHAT 单独 0.02 元
        "app.llm.budget.monthly-limit-cny=0.05",
        "app.llm.budget.scene-monthly-limits.chat=0.02"
})
@ActiveProfiles("standalone")
class LlmBudgetGuardTest {

    private static final String OWNER = "device_" + "a".repeat(43);
    private static final String OTHER = "device_" + "b".repeat(43);

    @Autowired JdbcTemplate sql;
    @Autowired LlmUsageMapper usageMapper;
    @Autowired LlmPricingProperties pricing;
    @Autowired LlmBudgetProperties budgetProperties;
    @Autowired LlmBudgetService budget;

    @BeforeEach
    void clean() {
        sql.execute("DELETE FROM llm_usage");
    }

    @AfterEach
    void clearContext() {
        RequestContext.clear();
    }

    // ---------------------------------------------------------------- 配置

    @Test
    void 未配额度时完全不拦截() {
        LlmBudgetProperties empty = new LlmBudgetProperties();
        LlmBudgetService service = new LlmBudgetService(usageMapper, pricing, empty);

        assertThat(service.isEnabled()).isFalse();
        insert(OWNER, LlmUsage.SCENE_CHAT, 999_999, LocalDateTime.now());
        assertThatCode(() -> service.check(OWNER, LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
    }

    @Test
    void 场景额度配置的key大小写不敏感() {
        LlmBudgetProperties props = new LlmBudgetProperties();
        props.setSceneMonthlyLimits(Map.of("chat", 0.02));
        // yml 里写 chat:，场景常量是 CHAT；不做归一化就会「配置看起来对了但不生效」
        assertThat(props.limitFor("CHAT")).isEqualTo(0.02);
        assertThat(props.limitFor("chat")).isEqualTo(0.02);
    }

    // ---------------------------------------------------------------- 分场景

    @Test
    void 场景额度超限只拦该场景() {
        // CHAT 花到 0.02 元（20,000 token），正好触顶
        insert(OWNER, LlmUsage.SCENE_CHAT, 20_000, LocalDateTime.now());

        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(429));

        // 关键断言：课表解析不受对话超预算影响
        assertThatCode(() -> budget.check(OWNER, LlmUsage.SCENE_PARSE_HTML))
                .doesNotThrowAnyException();
        assertThatCode(() -> budget.check(OWNER, LlmUsage.SCENE_PLAN))
                .doesNotThrowAnyException();
    }

    @Test
    void 场景额度未触顶时其它场景照样可用() {
        insert(OWNER, LlmUsage.SCENE_CHAT, 19_999, LocalDateTime.now());
        assertThatCode(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
    }

    // ---------------------------------------------------------------- 全局

    @Test
    void 全局额度超限拦住所有场景() {
        // 全部花在课表解析上（60,000 token = 0.06 元 > 0.05），CHAT 自己一分没花
        insert(OWNER, LlmUsage.SCENE_PARSE_HTML, 60_000, LocalDateTime.now());

        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(429));
        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_PARSE_HTML))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 全局额度未触顶时场景额度先报警() {
        // 合计 0.03 元（未到全局 0.05），但 CHAT 单项已到 0.02
        insert(OWNER, LlmUsage.SCENE_CHAT, 20_000, LocalDateTime.now());
        insert(OWNER, LlmUsage.SCENE_PLAN, 10_000, LocalDateTime.now());

        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT))
                .isInstanceOf(BusinessException.class);
        assertThatCode(() -> budget.check(OWNER, LlmUsage.SCENE_PLAN)).doesNotThrowAnyException();
    }

    // ---------------------------------------------------------------- 边界

    @Test
    void 上月的花费不计入本月() {
        LocalDateTime lastMonth = LocalDateTime.now().withDayOfMonth(1).minusDays(1);
        insert(OWNER, LlmUsage.SCENE_CHAT, 900_000, lastMonth);

        assertThatCode(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
        assertThat(budget.spentThisMonth(OWNER, LlmUsage.SCENE_CHAT)).isEqualTo(0.0);
    }

    @Test
    void 账号之间互不影响() {
        insert(OWNER, LlmUsage.SCENE_CHAT, 900_000, LocalDateTime.now());

        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT))
                .isInstanceOf(BusinessException.class);
        assertThatCode(() -> budget.check(OTHER, LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
    }

    @Test
    void 拿不到身份时跳过拦截() {
        // 与 LlmUsageRecorder 保持一致：没有身份就记不到用量，判定必然不超限
        insert(OWNER, LlmUsage.SCENE_CHAT, 900_000, LocalDateTime.now());
        assertThatCode(() -> budget.check(null, LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
        assertThatCode(() -> budget.check("  ", LlmUsage.SCENE_CHAT)).doesNotThrowAnyException();
    }

    @Test
    void 失败调用同样计入花费() {
        // token 已经花掉了，只记成功会系统性低估——与用量看板必须同一口径
        insert(OWNER, LlmUsage.SCENE_CHAT, 20_000, LocalDateTime.now(), LlmUsage.STATUS_ERROR);
        assertThatThrownBy(() -> budget.check(OWNER, LlmUsage.SCENE_CHAT))
                .isInstanceOf(BusinessException.class);
    }

    // ---------------------------------------------------------------- 装饰器

    @Test
    void 装饰器在调用前拦截且一次token都不花() {
        LlmClient delegate = Mockito.mock(LlmClient.class);
        LlmBudgetService blocking = Mockito.mock(LlmBudgetService.class);
        Mockito.doThrow(new BusinessException(429, "预算已用完"))
                .when(blocking).check(Mockito.anyString(), Mockito.anyString());

        RequestContext.setApiKey(OWNER);
        BudgetAwareLlmClient client = new BudgetAwareLlmClient(delegate, blocking);

        assertThatThrownBy(() -> client.chatJson(LlmUsage.SCENE_CHAT, List.of()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("预算已用完");
        // 关键：真实客户端一次都没被调用 → 这次请求没有产生任何费用
        Mockito.verify(delegate, Mockito.never()).chatJson(Mockito.anyString(), Mockito.any());
        Mockito.verify(delegate, Mockito.never()).chatJson(Mockito.any());
    }

    @Test
    void 装饰器未超限时正常透传且带上场景() {
        LlmClient delegate = Mockito.mock(LlmClient.class);
        LlmBudgetService passing = Mockito.mock(LlmBudgetService.class);
        Mockito.when(delegate.chatJson("CHAT", List.of())).thenReturn("{\"text\":\"ok\"}");

        RequestContext.setApiKey(OWNER);
        BudgetAwareLlmClient client = new BudgetAwareLlmClient(delegate, passing);

        assertThat(client.chatJson(LlmUsage.SCENE_CHAT, List.of())).isEqualTo("{\"text\":\"ok\"}");
        // 场景必须透传下去，否则用量埋点会全落到 UNKNOWN
        Mockito.verify(delegate).chatJson("CHAT", List.of());
    }

    @Test
    void 装饰器不吞掉providerId与配置状态() {
        LlmClient delegate = Mockito.mock(LlmClient.class);
        Mockito.when(delegate.providerId()).thenReturn("deepseek");
        Mockito.when(delegate.isConfigured()).thenReturn(true);

        BudgetAwareLlmClient client =
                new BudgetAwareLlmClient(delegate, Mockito.mock(LlmBudgetService.class));
        assertThat(client.providerId()).isEqualTo("deepseek");
        assertThat(client.isConfigured()).isTrue();
    }

    // ---------------------------------------------------------------- 夹具

    private void insert(String apiKey, String scene, int tokens, LocalDateTime at) {
        insert(apiKey, scene, tokens, at, LlmUsage.STATUS_SUCCESS);
    }

    private void insert(String apiKey, String scene, int tokens, LocalDateTime at, String status) {
        sql.update("INSERT INTO llm_usage (api_key, scene, provider, model, prompt_tokens,"
                        + " completion_tokens, total_tokens, stream, latency_ms, status, created_at)"
                        + " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                apiKey, scene, "deepseek", "deepseek-chat", tokens, 0, tokens,
                false, 100, status, java.sql.Timestamp.valueOf(at));
    }
}
