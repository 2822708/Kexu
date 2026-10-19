package com.timetable.eval;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.LlmBudgetService;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.LlmUsageRecorder;
import com.timetable.service.RequestValidationService;
import com.timetable.service.impl.AiServiceImpl;
import com.timetable.service.impl.CourseServiceImpl;
import com.timetable.service.impl.DailyPlanServiceImpl;
import com.timetable.service.impl.ExamServiceImpl;
import com.timetable.service.impl.MemoryServiceImpl;
import com.timetable.service.impl.NoticeServiceImpl;
import com.timetable.service.impl.PeriodConfigServiceImpl;
import com.timetable.service.impl.PromptTemplateRegistry;
import com.timetable.service.impl.RecurringScriptEvaluator;
import com.timetable.service.impl.RecurringTodoServiceImpl;
import com.timetable.service.impl.ScheduleServiceImpl;
import com.timetable.service.impl.StudentProfileServiceImpl;
import com.timetable.service.impl.TaskServiceImpl;
import com.timetable.service.impl.TodoServiceImpl;
import org.mybatis.spring.annotation.MapperScan;
import org.mockito.stubbing.Answer;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Iterator;
import java.util.List;

/**
 * 模型输出评估集的共享装配（6.2 #7）。
 *
 * <p>与既有 AI 测试同一套模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。差别在于<b>输入不是硬编码字符串，而是用例文件里的 JSON</b>——
 * 这样加用例只需改数据，不必改 Java 代码，评估集才可能被持续维护。
 *
 * <p>时钟固定在 {@code 2026-10-19}（周一）：用例里的「过去 / 未来」判定全部相对这个
 * 基准日，换机器、换时区、换日期都不会让结果漂移。
 */
final class ModelEvalSupport {

    private ModelEvalSupport() {
    }

    /** 全局基准日：所有用例的 today 都与它对齐。 */
    static final Instant FIXED_INSTANT = Instant.parse("2026-10-19T02:00:00Z");

    /**
     * 评估集专用 Profile。
     *
     * <p>必须全局唯一，且不能被任何生产 profile（{@code standalone} / {@code mysql} 等）激活——
     * 它同时承担两件事：把 {@link EvalApplication} 排除在完整应用上下文的组件扫描之外，
     * 以及让各评估测试类互相隔离 Spring 上下文。
     */
    static final String PROFILE = "model-eval-slice";

    static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 测试专用 Spring 装配。切片只导入本评估需要的服务，避免拉起整个应用。
     *
     * <p><b>{@code @Profile} 不是可选项。</b>本类位于 {@code com.timetable.eval}，
     * 正在 {@code TimetableApplication} 的 {@code @SpringBootApplication} 扫描范围内——
     * 不挂 Profile 的话，那些用完整应用上下文的集成测试（journey、notice 端点等）会把这里
     * 的 {@link Clock} bean 一起装进去，于是它们的「系统时钟」被悄悄换成评估集的固定时刻，
     * 表现为 snooze 到期判定、计划缓存失效判定莫名失败。这个坑很隐蔽：报错出现在
     * 完全无关的测试里，且单独跑那些测试又是绿的。
     */
    @Configuration(proxyBeanMethods = false)
    @Profile(PROFILE)
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class,
            ExamServiceImpl.class, TodoServiceImpl.class, RecurringTodoServiceImpl.class,
            RecurringScriptEvaluator.class, PeriodConfigServiceImpl.class, TaskServiceImpl.class,
            StudentProfileServiceImpl.class, MemoryServiceImpl.class, AiServiceImpl.class,
            DailyPlanServiceImpl.class, NoticeServiceImpl.class, AiEventRecorder.class,
            LlmUsageRecorder.class, LlmClientRegistry.class, LlmProperties.class,
            LlmBudgetService.class, LlmBudgetProperties.class, LlmPricingProperties.class,
            PromptTemplateRegistry.class})
    static class EvalApplication {
        @Bean
        Clock clock() {
            return Clock.fixed(FIXED_INSTANT, ZoneId.of("Asia/Shanghai"));
        }
    }

    /** 把一个 mock 的 {@link LlmClient} 配成「无论输入是什么都返回指定 JSON」。 */
    static Answer<String> alwaysReturn(String rawJson) {
        String json = rawJson;
        return invocation -> json;
    }

    static String toJson(JsonNode node) {
        try {
            return MAPPER.writeValueAsString(node);
        } catch (Exception e) {
            throw new IllegalStateException("用例 JSON 序列化失败", e);
        }
    }

    static JsonNode loadFixture(String scenario) throws IOException {
        String path = "model-eval/contracts/" + scenario + ".json";
        try (InputStream in = ModelEvalSupport.class.getClassLoader().getResourceAsStream(path)) {
            if (in == null) {
                throw new IllegalStateException("用例文件缺失：" + path);
            }
            return MAPPER.readTree(in.readAllBytes());
        }
    }

    /** 用例列表，便于参数化。 */
    static List<JsonNode> cases(JsonNode fixture) {
        return iterableToList(fixture.path("cases").elements());
    }

    private static List<JsonNode> iterableToList(Iterator<JsonNode> it) {
        List<JsonNode> out = new java.util.ArrayList<>();
        it.forEachRemaining(out::add);
        return out;
    }

    /**
     * 断言辅助：按路径取值并给出可读失败信息。
     *
     * <p>评估集的失败信息必须能直接定位到「哪条用例、哪个字段、期望什么、实际什么」，
     * 否则改了 prompt 之后一堆红根本不知道从哪看起。
     */
    static String failMessage(String caseId, String field, Object expected, Object actual) {
        return String.format("用例 %s 的 %s 不符：期望 [%s]，实际 [%s]", caseId, field, expected, actual);
    }
}
