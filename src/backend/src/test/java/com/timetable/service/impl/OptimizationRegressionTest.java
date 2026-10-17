package com.timetable.service.impl;

import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.service.LlmBudgetService;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.*;
import com.timetable.entity.*;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.*;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.*;
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
import org.mockito.ArgumentCaptor;

import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

/** Real transactions, mappers, services and migrated H2; only the external AI provider is mocked. */
@ActiveProfiles("optimization-regression")
@SpringBootTest(classes = OptimizationRegressionTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:optimization_regression;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class OptimizationRegressionTest {

    private static final String OWNER = "regression-owner";
    private static final String OTHER = "regression-other";

    @Configuration(proxyBeanMethods = false)
    @Profile("optimization-regression")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, AiServiceImpl.class,
            StudentProfileServiceImpl.class, MemoryServiceImpl.class, TaskServiceImpl.class,
            LlmClientRegistry.class, LlmProperties.class, LlmBudgetService.class, LlmBudgetProperties.class, LlmPricingProperties.class, PromptTemplateRegistry.class,
            // 成本治理 P0-1：AiServiceImpl 构造器依赖这两个埋点组件，
            // 本切片用显式 @Import 而非组件扫描，必须显式列入否则上下文起不来。
            AiEventRecorder.class, LlmUsageRecorder.class})
    static class TestApplication {
        @Bean
        MutableClock clock() { return new MutableClock(); }
    }

    static final class MutableClock extends Clock {
        private final ZoneId zone = ZoneId.of("Asia/Shanghai");
        private volatile Instant value = Instant.parse("2026-09-27T02:06:00Z");
        void set(LocalDateTime time) { value = time.atZone(zone).toInstant(); }
        @Override public ZoneId getZone() { return zone; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(value, zone); }
        @Override public Instant instant() { return value; }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired CourseService courses;
    @Autowired ExamService exams;
    @Autowired TodoService todos;
    @Autowired RecurringTodoService recurring;
    @Autowired AiService ai;
    @Autowired AiActionMapper actions;
    @Autowired AiConversationMapper conversations;
    @Autowired RecurringTodoMapper rules;
    @Autowired PeriodConfigService periods;
    @Autowired AdminAuthorizationService admins;
    @Autowired MutableClock clock;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'ADMIN')", OWNER, "Administrator");
        // A familiar old label must not confer new authorization after migration.
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OTHER, "Tangent0712");
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES ('configured-admin','Configured','USER')");
        clock.set(LocalDateTime.of(2026, 9, 27, 10, 6));
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void administratorRoleIsEnforcedInServiceAndCannotBeSpoofedByLabel() {
        PeriodConfigRequest request = periodRequest(LocalTime.of(8, 10), LocalTime.of(8, 55));
        LocalTime previous = periods.list().get(0).getStartTime();
        assertThat(admins.isAdmin(OTHER)).isFalse();
        assertThatThrownBy(() -> periods.update(request, OTHER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(403);
        assertThat(periods.list().get(0).getStartTime()).isEqualTo(previous);
        periods.update(request, OWNER);
        assertThat(periods.list().get(0).getStartTime()).isEqualTo(LocalTime.of(8, 10));
        assertThat(admins.isAdmin("configured-admin")).isTrue();
        assertThat(admins.isAdmin("nonexistent")).isFalse();
    }

    @Test
    void screenshotTextImportChecksImageAndOnlySendsItAsEphemeralUserInput() {
        String image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
        when(provider.chatJson(any(), any())).thenReturn("{\"text\":\"期末考试：6月12日 14:00\"}");

        assertThat(ai.parseImageText(image)).contains("期末考试");
        @SuppressWarnings({"unchecked", "rawtypes"})
        ArgumentCaptor<List<LlmClient.Message>> prompt =
                (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(provider).chatJson(any(), prompt.capture());
        assertThat(prompt.getValue()).hasSize(2);
        assertThat(prompt.getValue().get(1).getImageDataUrl()).isEqualTo(image);
        assertThatThrownBy(() -> ai.parseImageText("data:image/png;base64,/9j/AA=="))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(400);
    }

    @Test
    void periodBatchFailureRollsBackEarlierRows() {
        LocalTime previous = periods.list().get(0).getStartTime();
        PeriodConfigRequest request = periodRequest(LocalTime.of(7, 0), LocalTime.of(7, 45));
        PeriodConfigRequest.PeriodItem invalid = new PeriodConfigRequest.PeriodItem();
        invalid.setPeriodNumber(2);
        invalid.setStartTime(LocalTime.of(9, 0));
        invalid.setEndTime(LocalTime.of(8, 0));
        invalid.setCategory("MORNING");
        request.setConfigs(List.of(request.getConfigs().get(0), invalid));
        assertThatThrownBy(() -> periods.update(request, OWNER)).isInstanceOf(BusinessException.class);
        assertThat(periods.list().get(0).getStartTime()).isEqualTo(previous);
    }

    @Test
    void concurrentConfirmWritesBusinessRecordExactlyOnce() throws Exception {
        Schedule schedule = schedule(OWNER, "Concurrency");
        AiConversation conversation = conversation(schedule.getId(), OWNER);
        AiActionDto action = propose(conversation, createCourseJson("One only")).getActions().get(0);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Callable<Boolean> confirmation = () -> {
            ready.countDown();
            if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("confirmation barrier timed out");
            try {
                ai.executeAction(conversation.getId(), action.getActionId(), OWNER);
                return true;
            } catch (BusinessException conflict) {
                assertThat(conflict.getCode()).isEqualTo(409);
                return false;
            }
        };
        try {
            Future<Boolean> first = pool.submit(confirmation);
            Future<Boolean> second = pool.submit(confirmation);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(first.get(15, TimeUnit.SECONDS), second.get(15, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        } finally {
            start.countDown();
            pool.shutdownNow();
        }
        assertThat(courses.listByScheduleId(schedule.getId(), OWNER)).hasSize(1);
        assertThat(actions.selectById(action.getActionId()).getActionStatus()).isEqualTo("EXECUTED");
    }

    @Test
    void failedLegacyBatchRollsBackEveryMutationAndReleasesActionClaim() {
        Schedule schedule = schedule(OWNER, "Rollback");
        AiConversation conversation = conversation(schedule.getId(), OWNER);
        AiActionDto action = propose(conversation, createCourseJson("First")).getActions().get(0);
        // Legacy rows can still hold a multi-record action. A later invalid record must roll back the first.
        sql.update("UPDATE ai_action SET action_data=? WHERE id=?", """
                {"courses":[{"name":"First","dayOfWeek":1,"startPeriod":1,"endPeriod":2,"weeks":[1]},
                {"name":"Invalid","dayOfWeek":1,"startPeriod":4,"endPeriod":2,"weeks":[1]}]}
                """, action.getActionId());
        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), action.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class);
        assertThat(courses.listByScheduleId(schedule.getId(), OWNER)).isEmpty();
        assertThat(actions.selectById(action.getActionId()).getActionStatus()).isEqualTo("PENDING");
    }

    @Test
    void changedDataCommitsStaleStatusAndNeverExecutesOldProposal() {
        Schedule schedule = schedule(OWNER, "Stale");
        AiConversation conversation = conversation(schedule.getId(), OWNER);
        AiActionDto action = propose(conversation, createCourseJson("AI proposed")).getActions().get(0);
        courses.create(schedule.getId(), courseRequest("Manual change"), OWNER);
        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), action.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(409);
        assertThat(actions.selectById(action.getActionId()).getActionStatus()).isEqualTo("STALE");
        assertThat(courses.listByScheduleId(schedule.getId(), OWNER)).extracting(Course::getName)
                .containsExactly("Manual change");
    }

    @Test
    void proposalsAndInvalidationAreSeparatedBySchedule() {
        Schedule first = schedule(OWNER, "First");
        Schedule second = schedule(OWNER, "Second");
        AiConversation firstConversation = conversation(first.getId(), OWNER);
        AiConversation secondConversation = conversation(second.getId(), OWNER);
        AiActionDto firstAction = propose(firstConversation, createCourseJson("A")).getActions().get(0);
        AiActionDto secondAction = propose(secondConversation, createCourseJson("B")).getActions().get(0);
        assertThat(actions.selectById(firstAction.getActionId()).getActionStatus()).isEqualTo("PENDING");
        ai.invalidateProposalsOnDataChange(OWNER, "COURSE", first.getId());
        assertThat(actions.selectById(firstAction.getActionId()).getActionStatus()).isEqualTo("STALE");
        assertThat(actions.selectById(secondAction.getActionId()).getActionStatus()).isEqualTo("PENDING");
        ai.executeAction(secondConversation.getId(), secondAction.getActionId(), OWNER);
        assertThat(courses.listByScheduleId(second.getId(), OWNER)).extracting(Course::getName).containsExactly("B");
    }

    @Test
    void aiCannotProposeOrExecuteCourseDeletionInAnotherOwnedSchedule() {
        Schedule first = schedule(OWNER, "First");
        Schedule second = schedule(OWNER, "Second");
        Course target = courses.create(second.getId(), courseRequest("Keep"), OWNER);
        AiConversation conversation = conversation(first.getId(), OWNER);
        String delete = "{\"text\":\"Delete\",\"actions\":[{\"type\":\"DELETE_COURSE\",\"data\":{\"courseIds\":["
                + target.getId() + "]}}]}";
        assertThat(propose(conversation, delete).getActions()).isEmpty();
        AiActionDto legacy = propose(conversation, createCourseJson("Placeholder")).getActions().get(0);
        sql.update("UPDATE ai_action SET action_type='DELETE_COURSE',action_data=? WHERE id=?",
                "{\"courseIds\":[" + target.getId() + "]}", legacy.getActionId());
        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), legacy.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class);
        assertThat(courses.listByScheduleId(second.getId(), OWNER)).hasSize(1);
        assertThat(actions.selectById(legacy.getActionId()).getActionStatus()).isEqualTo("PENDING");
    }

    @Test
    void invalidProposalsProduceNoCardsAndDoNotInvalidateValidPendingWork() {
        Schedule schedule = schedule(OWNER, "Validation");
        AiConversation conversation = conversation(schedule.getId(), OWNER);
        AiActionDto pending = propose(conversation, createCourseJson("Valid")).getActions().get(0);
        AiMessageResponse invalid = propose(conversation, """
                {"text":"Invalid response","actions":[
                {"type":"UNKNOWN","data":{}},
                {"type":"CREATE_COURSE","data":{"courses":[{"name":"Bad","dayOfWeek":8,"startPeriod":1,"endPeriod":2,"weeks":[1]}]}},
                {"type":"CREATE_TODO","data":{"todos":[]}},
                {"type":"CREATE_RECURRING","data":{"rules":[{"title":"Bad script","frequency":"CUSTOM","script":"broken (","ddlOffsetMinutes":10}]}}
                ]}
                """);
        assertThat(invalid.getActions()).isEmpty();
        assertThat(invalid.getText()).startsWith("Invalid response").isNotEqualTo("Invalid response");
        assertThat(actions.selectById(pending.getActionId()).getActionStatus()).isEqualTo("PENDING");
        assertThat(courses.listByScheduleId(schedule.getId(), OWNER)).isEmpty();
    }

    @Test
    void foreignFirstMessageCannotBindUnboundConversation() {
        Schedule other = schedule(OTHER, "Foreign");
        AiConversation conversation = conversation(null, OWNER);
        AiMessageRequest request = new AiMessageRequest();
        request.setScheduleId(other.getId());
        request.setContent("Try foreign schedule");
        assertThatThrownBy(() -> ai.sendMessage(conversation.getId(), request, OWNER))
                .isInstanceOf(BusinessException.class);
        assertThat(conversations.selectById(conversation.getId()).getScheduleId()).isNull();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM ai_message", Integer.class)).isZero();
    }

    @Test
    void cancelledStreamDoesNotPersistAssistantOrProposal() {
        Schedule schedule = schedule(OWNER, "Cancellation");
        AiConversation conversation = conversation(schedule.getId(), OWNER);
        AtomicBoolean cancelled = new AtomicBoolean(false);
        // 成本治理 P0-1 后流式签名为 4 参：(scene, messages, listener, cancelled)
        when(provider.chatJsonStream(any(), any(), any(), any())).thenAnswer(invocation -> {
            cancelled.set(true);
            return createCourseJson("Should not be saved");
        });
        AiMessageRequest request = new AiMessageRequest();
        request.setScheduleId(schedule.getId());
        request.setContent("Cancel this");
        assertThatThrownBy(() -> ai.sendMessageStream(conversation.getId(), request, OWNER, new AiService.StreamCallback() {
            @Override public void onThinking(String delta) {}
            @Override public void onText(String delta) {}
            @Override public void onPlanning() {}
            @Override public boolean isCancelled() { return cancelled.get(); }
        })).isInstanceOf(BusinessException.class);
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM ai_action", Integer.class)).isZero();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM ai_message WHERE role='assistant'", Integer.class)).isZero();
    }

    @Test
    void scheduleDeletionRemovesDependentsButPreservesAccountWideAndOtherScheduleData() {
        Schedule deleted = schedule(OWNER, "Delete");
        Schedule kept = schedule(OWNER, "Keep");
        courses.create(deleted.getId(), courseRequest("Delete course"), OWNER);
        courses.create(kept.getId(), courseRequest("Keep course"), OWNER);
        Exam removedExam = exams.create(deleted.getId(), examRequest("Delete exam"), OWNER);
        Exam keptExam = exams.create(kept.getId(), examRequest("Keep exam"), OWNER);
        Todo manual = todos.create(todoRequest("Manual"), OWNER);
        AiConversation removedConversation = conversation(deleted.getId(), OWNER);
        AiConversation keptConversation = conversation(kept.getId(), OWNER);
        AiActionDto removedAction = propose(removedConversation, createCourseJson("Removed proposal")).getActions().get(0);
        AiActionDto keptAction = propose(keptConversation, createCourseJson("Kept proposal")).getActions().get(0);
        assertThatThrownBy(() -> schedules.delete(deleted.getId(), OTHER)).isInstanceOf(BusinessException.class);
        schedules.delete(deleted.getId(), OWNER);
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM course WHERE schedule_id=?", Integer.class, deleted.getId())).isZero();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM exam WHERE id=?", Integer.class, removedExam.getId())).isZero();
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM todo WHERE exam_id=?", Integer.class, removedExam.getId())).isZero();
        assertThat(todos.list(OWNER)).extracting(Todo::getId).contains(manual.getId());
        assertThat(todos.list(OWNER)).extracting(Todo::getExamId).contains(keptExam.getId());
        assertThat(courses.listByScheduleId(kept.getId(), OWNER)).hasSize(1);
        assertThat(conversations.selectById(removedConversation.getId()).getScheduleId()).isNull();
        assertThat(actions.selectById(removedAction.getActionId()).getActionStatus()).isEqualTo("STALE");
        assertThat(actions.selectById(keptAction.getActionId()).getActionStatus()).isEqualTo("PENDING");
    }

    @Test
    void aiCompletionUsesSameRecurringChainAsManualCompletion() {
        RecurringTodo rule = recurring.create(dailyRule(true), OWNER);
        recurring.triggerNow(rule.getId(), OWNER);
        Todo first = todos.list(OWNER).get(0);
        AiConversation conversation = conversation(null, OWNER);
        AiActionDto action = propose(conversation, "{\"text\":\"Complete\",\"actions\":[{\"type\":\"TOGGLE_TODO\",\"data\":{\"todoIds\":["
                + first.getId() + "]}}]}").getActions().get(0);
        ai.executeAction(conversation.getId(), action.getActionId(), OWNER);
        assertThat(todos.list(OWNER)).hasSize(2);
        assertThat(todos.list(OWNER).stream().filter(t -> t.getId().equals(first.getId())).findFirst().orElseThrow().getCompleted())
                .isTrue();
        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), action.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class);
        assertThat(todos.list(OWNER)).hasSize(2);
    }

    @Test
    void customRuleReplaysMissedMinuteAndDoesNotDuplicateOnNextScan() {
        RecurringTodo rule = recurring.create(customRule("function shouldTrigger(ctx) { return ctx.minute === 5; }"), OWNER);
        sql.update("UPDATE recurring_todo SET last_evaluated_at=? WHERE id=?", LocalDateTime.of(2026, 9, 27, 10, 3), rule.getId());
        assertThat(recurring.generateDueTodos()).isEqualTo(1);
        assertThat(todos.list(OWNER)).hasSize(1);
        assertThat(todos.list(OWNER).get(0).getDdl()).isEqualTo(LocalDateTime.of(2026, 9, 27, 10, 15));
        assertThat(recurring.generateDueTodos()).isZero();
        assertThat(todos.list(OWNER)).hasSize(1);
        assertThat(rules.selectById(rule.getId()).getLastEvaluatedAt()).isEqualTo(LocalDateTime.of(2026, 9, 27, 10, 6));
    }

    @Test
    void longCustomOutageIsBoundedAndNonmatchingEvaluationAdvancesCursor() {
        RecurringTodo rule = recurring.create(customRule("function shouldTrigger(ctx) { return ctx.minute === 30; }"), OWNER);
        sql.update("UPDATE recurring_todo SET last_evaluated_at=? WHERE id=?", LocalDateTime.of(2026, 9, 27, 8, 0), rule.getId());
        assertThat(recurring.generateDueTodos()).isZero();
        assertThat(todos.list(OWNER)).isEmpty();
        assertThat(rules.selectById(rule.getId()).getLastEvaluatedAt()).isEqualTo(LocalDateTime.of(2026, 9, 27, 10, 6));
    }

    @Test
    void fixedRuleCatchUpIsBoundedAndRepeatedScanIsIdempotent() {
        RecurringTodo rule = recurring.create(dailyRule(false), OWNER);
        sql.update("UPDATE recurring_todo SET next_trigger_at=? WHERE id=?", LocalDateTime.of(2026, 9, 1, 9, 0), rule.getId());
        assertThat(recurring.generateDueTodos()).isEqualTo(5);
        assertThat(todos.list(OWNER)).hasSize(5);
        assertThat(recurring.generateDueTodos()).isZero();
        assertThat(todos.list(OWNER)).hasSize(5);
        assertThat(rules.selectById(rule.getId()).getNextTriggerAt()).isAfter(LocalDateTime.now(clock));
    }

    private Schedule schedule(String key, String name) {
        ScheduleRequest request = new ScheduleRequest();
        request.setName(name);
        request.setPeriodStartDate(LocalDate.of(2026, 9, 7));
        request.setPeriodEndDate(LocalDate.of(2027, 1, 31));
        return schedules.create(request, key);
    }

    private AiConversation conversation(Long scheduleId, String key) {
        AiConversationRequest request = new AiConversationRequest();
        request.setScheduleId(scheduleId);
        request.setTitle("Regression conversation");
        return ai.createConversation(request, key);
    }

    private AiMessageResponse propose(AiConversation conversation, String json) {
        when(provider.chatJson(any(), any())).thenReturn(json);
        AiMessageRequest request = new AiMessageRequest();
        request.setContent("Propose changes");
        request.setScheduleId(conversation.getScheduleId());
        return ai.sendMessage(conversation.getId(), request, OWNER);
    }

    private static String createCourseJson(String name) {
        return "{\"text\":\"Proposed\",\"actions\":[{\"type\":\"CREATE_COURSE\",\"data\":{\"courses\":[{\"name\":\""
                + name + "\",\"dayOfWeek\":1,\"startPeriod\":1,\"endPeriod\":2,\"weeks\":[1]}]}}]}";
    }

    private static CourseRequest courseRequest(String name) {
        CourseRequest request = new CourseRequest();
        request.setName(name);
        request.setDayOfWeek(1);
        request.setStartPeriod(1);
        request.setEndPeriod(2);
        request.setWeeks(List.of(1));
        return request;
    }

    private static ExamRequest examRequest(String name) {
        ExamRequest request = new ExamRequest();
        request.setName(name);
        request.setExamDate(LocalDate.of(2026, 10, 1));
        request.setStartTime(LocalTime.of(9, 0));
        request.setEndTime(LocalTime.of(10, 0));
        return request;
    }

    private static TodoRequest todoRequest(String title) {
        TodoRequest request = new TodoRequest();
        request.setTitle(title);
        request.setDdl(LocalDateTime.of(2026, 10, 1, 20, 0));
        return request;
    }

    private static RecurringTodoRequest dailyRule(boolean chain) {
        RecurringTodoRequest request = new RecurringTodoRequest();
        request.setTitle("Daily regression rule");
        request.setFrequency("DAILY");
        request.setTriggerTime(LocalTime.of(9, 0));
        request.setDdlOffsetMinutes(10);
        request.setEnabled(true);
        request.setChainAfterComplete(chain);
        return request;
    }

    private static RecurringTodoRequest customRule(String script) {
        RecurringTodoRequest request = dailyRule(false);
        request.setFrequency("CUSTOM");
        request.setScript(script);
        request.setTriggerTime(null);
        return request;
    }

    private static PeriodConfigRequest periodRequest(LocalTime start, LocalTime end) {
        PeriodConfigRequest.PeriodItem item = new PeriodConfigRequest.PeriodItem();
        item.setPeriodNumber(1);
        item.setStartTime(start);
        item.setEndTime(end);
        item.setCategory("MORNING");
        PeriodConfigRequest request = new PeriodConfigRequest();
        request.setConfigs(List.of(item));
        return request;
    }
}
