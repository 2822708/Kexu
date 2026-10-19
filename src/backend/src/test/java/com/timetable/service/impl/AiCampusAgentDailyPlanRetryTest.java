package com.timetable.service.impl;

import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.DailyPlanDto;
import com.timetable.dto.ScheduleRequest;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.DailyPlanService;
import com.timetable.service.LlmBudgetService;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.RequestValidationService;
import com.timetable.service.ScheduleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 每日计划的失败重试与并发去重（成本治理 6.1 #6）。
 *
 * <p>与 {@code AiCampusAgentDailyPlanTest} 分开是因为本类要验证「会等、会重试」，
 * 必须换个测试上下文把退避压到毫秒级——否则跑一遍要等好几秒。
 *
 * <p>钉住三件事：
 * <ol>
 *   <li>模型输出不合规（502）会重试，且重试成功后只落一条计划；</li>
 *   <li>不可重试的错误（模板缺失 500、未配置 provider 503）**一次都不重试**；</li>
 *   <li>同账号同日并发调用只真正调一次模型——这是重复烧 token 的唯一入口。</li>
 * </ol>
 */
@ActiveProfiles("campus-agent-plan-retry")
@SpringBootTest(classes = AiCampusAgentDailyPlanRetryTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_plan_retry;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN",
        // 退避压到很小：契约是「重试几次 / 分不分类」，不是「等多久」
        "app.llm.plan-retry.initial-backoff-ms=5",
        "app.llm.plan-retry.max-backoff-ms=10",
        "app.llm.plan-retry.jitter-ms=0",
        "app.llm.plan-retry.max-attempts=3"
})
class AiCampusAgentDailyPlanRetryTest {

    private static final String OWNER = "retry-owner";
    /** 2026-09-28 是周一。 */
    private static final LocalDate MONDAY = LocalDate.of(2026, 9, 28);

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-plan-retry")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, TaskServiceImpl.class, StudentProfileServiceImpl.class,
            MemoryServiceImpl.class, DailyPlanServiceImpl.class,
            LlmClientRegistry.class, LlmProperties.class, LlmBudgetService.class, LlmBudgetProperties.class,
            LlmPricingProperties.class, PromptTemplateRegistry.class})
    static class TestApplication {
        @Bean
        Clock clock() {
            return Clock.systemDefaultZone();
        }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired DailyPlanService plans;
    @Autowired LlmProperties llmProperties;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("daily_plan", "task", "exam", "course", "schedule",
                "api_key", "student_profile")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Retry owner");
        when(provider.isConfigured()).thenReturn(true);
        // 复位配置：单条用例可能改过
        llmProperties.getPlanRetry().setEnabled(true);
        llmProperties.getPlanRetry().setMaxAttempts(3);
    }

    @Test
    void retriesWhenModelOutputFailsValidationThenSucceeds() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        // 前两次都漏了休息（502），第三次合规
        when(provider.chatJson(any(), any()))
                .thenReturn(planJson("""
                        {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""}
                        """.formatted(courseId), "第一版没有休息"))
                .thenReturn("模型这次干脆不返回 JSON")
                .thenReturn(planJson("""
                        {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""},
                        {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                        """.formatted(courseId), "第三版终于对了"));

        DailyPlanDto plan = plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(plan.isCached()).isFalse();
        assertThat(plan.getSummary()).isEqualTo("第三版终于对了");
        assertThat(plan.getItems()).hasSize(2);
        // 失败两次 + 成功一次；校验没过的那两次不能落库
        verify(provider, times(3)).chatJson(any(), any());
        assertThat(rowCount()).isEqualTo(1);
    }

    @Test
    void givesUpAfterMaxAttemptsAndReportsTheRealReason() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        // 永远漏课：三次都不合规
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                {"type":"SUGGESTION","start":"10:00","end":"11:00","title":"自习","ref_id":null,"note":""},
                {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """, "永远是这一版"));

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("遗漏了今天的课程");
        verify(provider, times(3)).chatJson(any(), any());
        assertThat(rowCount()).isZero();
    }

    @Test
    void doesNotRetryWhenProviderIsNotConfigured() {
        Schedule schedule = schedule();
        seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.isConfigured()).thenReturn(false);

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("AI 服务未配置");
        // 503「没配置」重试一百次也还是没配置，不该白等
        verify(provider, times(0)).chatJson(any(), any());
        assertThat(rowCount()).isZero();
    }

    @Test
    void retryCanBeDisabledForRollback() {
        Schedule schedule = schedule();
        seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        llmProperties.getPlanRetry().setEnabled(false);
        when(provider.chatJson(any(), any())).thenReturn("不是 JSON");

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("未返回可解析的计划");
        // 关掉即退化为 V1.0：一次就放弃
        verify(provider, times(1)).chatJson(any(), any());
    }

    @Test
    void keepsPreviousPlanWhenEveryRetryFails() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        String good = planJson("""
                {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""},
                {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "旧计划还在");
        when(provider.chatJson(any(), any())).thenReturn(good);
        plans.generate(OWNER, schedule.getId(), MONDAY);

        // 让旧计划变 stale：新增一个任务，输入就变了
        sql.update("INSERT INTO task(api_key,title,type,priority,status,description,created_at,updated_at) "
                + "VALUES (?,?,?,?,?,?,?,?)", OWNER, "临时作业", "COURSE_WORK", 2, "PENDING", "",
                java.time.LocalDateTime.now(), java.time.LocalDateTime.now());

        // 模型从此只会输出垃圾
        when(provider.chatJson(any(), any())).thenReturn("完全不是 JSON");
        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class);

        // 关键：重算失败不该把用户手里那份旧计划一起弄没
        DailyPlanDto stillThere = plans.get(OWNER, MONDAY);
        assertThat(stillThere).isNotNull();
        assertThat(stillThere.getSummary()).isEqualTo("旧计划还在");
        assertThat(rowCount()).isEqualTo(1);
    }

    @Test
    void concurrentGenerateOnlyCallsModelOnce() throws Exception {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        String plan = planJson("""
                {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""},
                {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "并发只该生成一次");

        AtomicInteger modelCalls = new AtomicInteger();
        CountDownLatch modelEntered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(provider.chatJson(any(), any())).thenAnswer(invocation -> {
            modelCalls.incrementAndGet();
            modelEntered.countDown();
            // 拖住第一次调用，保证其余线程必然在等锁而不是抢在缓存写入前读完就返回。
            // 只卡第一次：若实现退化成「不加锁」，第一个线程等不到第二次的 countDown 也不会影响结论，
            // 反而会因 modelCalls>1 直接判失败。
            if (modelCalls.get() == 1) {
                release.await(5, TimeUnit.SECONDS);
            }
            return plan;
        });

        int threads = 6;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            List<Future<DailyPlanDto>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> plans.generate(OWNER, schedule.getId(), MONDAY)));
            }
            assertThat(modelEntered.await(5, TimeUnit.SECONDS)).isTrue();
            release.countDown();

            List<DailyPlanDto> results = new ArrayList<>();
            for (Future<DailyPlanDto> future : futures) {
                results.add(future.get(10, TimeUnit.SECONDS));
            }

            assertThat(results).hasSize(threads);
            // 只有一个请求真调了模型，其余全部命中缓存
            assertThat(modelCalls.get()).isEqualTo(1);
            assertThat(results.stream().filter(DailyPlanDto::isCached)).hasSize(threads - 1);
            // 不能出现两行同一天（uk 也可能直接炸在 insert 上）
            assertThat(rowCount()).isEqualTo(1);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    // ==================== 辅助 ====================

    private int rowCount() {
        return sql.queryForObject("SELECT COUNT(*) FROM daily_plan", Integer.class);
    }

    private String planJson(String items, String summary) {
        return """
                {"date":"2026-09-28","items":[%s],"summary":"%s"}
                """.formatted(items, summary).replace("\n", "");
    }

    private Schedule schedule() {
        ScheduleRequest request = new ScheduleRequest();
        request.setName("Retry schedule");
        request.setPeriodStartDate(LocalDate.of(2026, 9, 7));
        request.setPeriodEndDate(LocalDate.of(2027, 1, 31));
        return schedules.create(request, OWNER);
    }

    private Long seedCourse(Long scheduleId, String name, int dayOfWeek, int start, int end) {
        sql.update("INSERT INTO course(schedule_id,name,day_of_week,start_period,end_period,weeks) "
                + "VALUES (?,?,?,?,?,?)", scheduleId, name, dayOfWeek, start, end, "[1,2,3,4]");
        return sql.queryForObject("SELECT MAX(id) FROM course WHERE schedule_id=?", Long.class, scheduleId);
    }
}
