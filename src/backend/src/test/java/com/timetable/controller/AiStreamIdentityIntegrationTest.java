package com.timetable.controller;

import com.timetable.TimetableApplication;
import com.timetable.dto.AiMessageRequest;
import com.timetable.interceptor.RequestContext;
import com.timetable.mapper.AiConversationMapper;
import com.timetable.mapper.ScheduleMapper;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Schedule;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 流式对话的「身份传递」（成本治理 P0-1/P0-2 的防回归）。
 *
 * <p><b>这个测试对应一个只有真实调用才能暴露的缺陷</b>：SSE 对话跑在
 * {@code streamExecutor} 的工作线程上，而 {@link RequestContext} 是 ThreadLocal，
 * 下游 {@code DeepSeekLlmClient} 取到的 apiKey 是 null。后果有两个，且都是静默的：
 * <ul>
 *   <li>用量记不进来 → 对话（token 消耗最大的场景）在统计页完全消失；</li>
 *   <li>预算检查跳过 → 对话永远不会熔断，额度形同虚设。</li>
 * </ul>
 *
 * <p>用 mock 的 LLM 客户端测不出来这个 bug——因为被替换掉的正是读 ThreadLocal 的那段代码。
 * 所以这里让 mock <b>在被调用时主动读一次 RequestContext</b>，精确复现真实客户端的行为，
 * 从而断言「身份确实传进了工作线程」。
 */
@SpringBootTest(classes = TimetableApplication.class, properties = {
        "spring.datasource.url=jdbc:h2:mem:ai_stream_identity;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.bootstrap-key=", "app.admin-api-keys=", "app.backup.enabled=false",
        "logging.file.name=", "logging.file.path=", "logging.level.com.timetable=WARN"
})
@ActiveProfiles("standalone")
class AiStreamIdentityIntegrationTest {

    private static final String OWNER = "device_" + "s".repeat(43);

    @Autowired JdbcTemplate sql;
    @Autowired AiController aiController;
    @Autowired ScheduleMapper scheduleMapper;
    @Autowired AiConversationMapper conversationMapper;
    @MockBean LlmClient provider;

    @BeforeEach
    void setUp() {
        // LlmClientRegistry.active() 在没有任何客户端 isConfigured() 时抛 503
        // BusinessException——不 stub 它，工作线程在调用模型之前就失败，
        // 表现为「mock 没被调用、没有 error 日志、onError 也没触发」
        // （BusinessException 分支只 emit error 事件并 complete，不打日志）。
        when(provider.isConfigured()).thenReturn(true);
        // schedule / ai_conversation 都有 api_key 外键，先建身份（每个用例都会跑，要幂等）
        Integer exists = sql.queryForObject(
                "SELECT COUNT(*) FROM api_key WHERE api_key = ?", Integer.class, OWNER);
        if (exists == null || exists == 0) {
            sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')",
                    OWNER, "Stream identity");
        }
        sql.execute("DELETE FROM llm_usage");
        sql.execute("DELETE FROM ai_action");
        sql.execute("DELETE FROM ai_message");
        sql.execute("DELETE FROM ai_conversation");
    }

    @AfterEach
    void tearDown() {
        RequestContext.clear();
    }

    @Test
    void 流式对话的工作线程里能取到调用方身份() throws Exception {
        long scheduleId = createSchedule();
        long conversationId = createConversation(scheduleId);

        CountDownLatch called = new CountDownLatch(1);
        AtomicReference<String> seenInWorkerThread = new AtomicReference<>("(未调用)");
        AtomicReference<String> workerThreadName = new AtomicReference<>("?");

        // 关键：mock 在被调用时读一次 ThreadLocal，模拟真实客户端取身份的行为
        when(provider.chatJsonStream(any(), any(), any(), any())).thenAnswer(invocation -> {
            seenInWorkerThread.set(String.valueOf(RequestContext.getApiKey()));
            workerThreadName.set(Thread.currentThread().getName());
            called.countDown();
            LlmClient.StreamListener listener = invocation.getArgument(2);
            listener.onContent("{\"text\":\"好的\",\"actions\":[]}");
            return "{\"text\":\"好的\",\"actions\":[]}";
        });

        // 模拟拦截器：只有主线程里有身份
        RequestContext.setApiKey(OWNER);
        AiMessageRequest request = new AiMessageRequest();
        request.setScheduleId(scheduleId);
        request.setContent("帮我加一门课");
        SseEmitter emitter = aiController.sendMessageStream(conversationId, request);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        emitter.onError(failure::set);

        assertThat(called.await(15, TimeUnit.SECONDS))
                .as("流式调用应在工作线程里发生（线程名=%s，异常=%s）",
                        workerThreadName.get(), failure.get())
                .isTrue();
        // 断言①：身份确实传进了工作线程（这条挂在修复前会失败）
        assertThat(seenInWorkerThread.get()).isEqualTo(OWNER);
        // 断言②：确实发生在另一个线程上，否则这个测试没有意义
        assertThat(workerThreadName.get()).startsWith("ai-stream-");

        emitter.complete();
    }

    @Test
    void 工作线程的身份用完必须清理避免串号() throws Exception {
        long scheduleId = createSchedule();
        long conversationId = createConversation(scheduleId);

        CountDownLatch called = new CountDownLatch(1);
        when(provider.chatJsonStream(any(), any(), any(), any())).thenAnswer(invocation -> {
            LlmClient.StreamListener listener = invocation.getArgument(2);
            listener.onContent("{\"text\":\"好的\",\"actions\":[]}");
            called.countDown();
            return "{\"text\":\"好的\",\"actions\":[]}";
        });

        RequestContext.setApiKey(OWNER);
        AiMessageRequest request = new AiMessageRequest();
        request.setScheduleId(scheduleId);
        request.setContent("再帮我加一门课");
        aiController.sendMessageStream(conversationId, request);

        assertThat(called.await(15, TimeUnit.SECONDS)).isTrue();
        // 异步线程结束后，主线程的身份不该被 finally 里的 clear 误伤
        assertThat(RequestContext.getApiKey()).isEqualTo(OWNER);
    }

    private long createSchedule() {
        Schedule schedule = new Schedule();
        schedule.setApiKey(OWNER);
        schedule.setName("流式身份测试");
        schedule.setPeriodStartDate(LocalDate.now().minusDays(30));
        schedule.setPeriodEndDate(LocalDate.now().plusDays(120));
        scheduleMapper.insert(schedule);
        return schedule.getId();
    }

    private long createConversation(Long scheduleId) {
        AiConversation conversation = new AiConversation();
        conversation.setApiKey(OWNER);
        conversation.setScheduleId(scheduleId);
        conversation.setTitle("stream");
        conversationMapper.insert(conversation);
        return conversation.getId();
    }
}
