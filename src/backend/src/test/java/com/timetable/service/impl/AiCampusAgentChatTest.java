package com.timetable.service.impl;

import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.AiActionDto;
import com.timetable.dto.ScheduleRequest;
import com.timetable.dto.StudentProfilePatch;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Memory;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.AiActionMapper;
import com.timetable.mapper.MemoryMapper;
import com.timetable.mapper.StudentProfileMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.LlmUsageRecorder;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.MemoryService;
import com.timetable.service.RequestValidationService;
import com.timetable.service.ScheduleService;
import com.timetable.service.StudentProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI Campus Agent V1.0 Step 2：学长人格接入 + 记忆提炼提案链路。
 *
 * 与 OptimizationRegressionTest 同一模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。人格与提炼 Prompt 来自 classpath 模板（真实加载）。
 */
@ActiveProfiles("campus-agent-chat")
@SpringBootTest(classes = AiCampusAgentChatTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_chat;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentChatTest {

    private static final String OWNER = "campus-owner";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-chat")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, AiServiceImpl.class,
            StudentProfileServiceImpl.class, MemoryServiceImpl.class, TaskServiceImpl.class,
            LlmClientRegistry.class, LlmProperties.class, PromptTemplateRegistry.class, AiEventRecorder.class, LlmUsageRecorder.class })
    static class TestApplication {
        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-09-27T02:06:00Z"), ZoneId.of("Asia/Shanghai"));
        }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired AiService ai;
    @Autowired AiActionMapper actions;
    @Autowired MemoryMapper memories;
    @Autowired StudentProfileMapper profiles;
    @Autowired MemoryService memoryService;
    @Autowired StudentProfileService studentProfileService;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Campus owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void systemPromptCarriesSeniorPersonaAndProposalProtocol() {
        Schedule schedule = schedule(OWNER, "Persona");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("线性代数"));

        ai.sendMessage(conversation.getId(), request(schedule.getId(), "这学期有什么课"), OWNER);

        @SuppressWarnings({"unchecked", "rawtypes"})
        ArgumentCaptor<List<LlmClient.Message>> prompt =
                (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(provider, atLeastOnce()).chatJson(any(), prompt.capture());
        // getAllValues().get(0) 是主聊天调用（人格与协议在其 system 消息里）；
        // 第二次 chatJson 是记忆提炼，用的是 memory-extract 模板，不能混用
        String system = prompt.getAllValues().get(0).get(0).getContent();
        assertThat(system).contains("学长");
        assertThat(system).contains("action.type");
        assertThat(system).contains("不直接修改任何数据");
        assertThat(system).contains("已有课程");
    }

    @Test
    void refinementProposesMemoryAndProfileAndExecuteWritesBoth() {
        Schedule schedule = schedule(OWNER, "Refine");
        AiConversation conversation = conversation(schedule.getId());
        // 预置档案：让 UPDATE_PROFILE 的 _before 快照与前端 diff 有真实意义
        //（首次对话无档案时 _before 为空对象，属「新建档案」语义，另由快照方法覆盖）
        StudentProfilePatch seed = new StudentProfilePatch();
        seed.setName("小明");
        studentProfileService.applyPatch(OWNER, seed, StudentProfile.UPDATED_BY_USER);
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试","importance":5}],
                 "profile":{"major":"计算机科学与技术","goal":"通过六级"}}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "我报了 12 月的六级，以后请多提醒我"), OWNER);

        List<AiActionDto> memoryActions = response.getActions().stream()
                .filter(a -> "SAVE_MEMORY".equals(a.getType())).toList();
        List<AiActionDto> profileActions = response.getActions().stream()
                .filter(a -> "UPDATE_PROFILE".equals(a.getType())).toList();
        assertThat(memoryActions).hasSize(1);
        assertThat(profileActions).hasSize(1);
        assertThat(memoryActions.get(0).getScope()).isEqualTo("MEMORY");
        assertThat(profileActions.get(0).getScope()).isEqualTo("PROFILE");
        assertThat(memoryActions.get(0).getStatus()).isEqualTo("PENDING");
        // 提案必须带 _before：档案快照供前端展示 diff 与撤销
        assertThat(profileActions.get(0).getData().get("_before")).isNotNull();

        // 用户确认后才落库（human-in-the-loop 边界）：记忆为空，档案仍只有预置的那一份
        assertThat(memories.selectCount(null)).isZero();
        assertThat(profiles.selectCount(null)).isEqualTo(1);
        assertThat(studentProfileService.find(OWNER).getMajor()).isNull();

        ai.executeAction(conversation.getId(), memoryActions.get(0).getActionId(), OWNER);
        ai.executeAction(conversation.getId(), profileActions.get(0).getActionId(), OWNER);

        List<Memory> stored = memoryService.listActive(OWNER);
        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getContent()).isEqualTo("准备 12 月 CET-6 考试");
        assertThat(stored.get(0).getType()).isEqualTo(Memory.TYPE_GOAL);
        assertThat(stored.get(0).getImportance()).isEqualTo(5);
        assertThat(stored.get(0).getSource()).isEqualTo(Memory.SOURCE_AI);
        assertThat(stored.get(0).getStatus()).isEqualTo(Memory.STATUS_ACTIVE);

        StudentProfile profile = studentProfileService.find(OWNER);
        assertThat(profile.getMajor()).isEqualTo("计算机科学与技术");
        assertThat(profile.getGoal()).isEqualTo("通过六级");
        assertThat(profile.getUpdatedBy()).isEqualTo(StudentProfile.UPDATED_BY_AI);
    }

    @Test
    void multipleMemoriesSplitIntoIndependentProposals() {
        Schedule schedule = schedule(OWNER, "Split");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试","importance":5},
                             {"type":"HABIT","content":"习惯晚饭后散步","importance":2}]}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "我报了六级，平时喜欢晚饭后散步"), OWNER);

        List<AiActionDto> memoryActions = response.getActions().stream()
                .filter(a -> "SAVE_MEMORY".equals(a.getType())).toList();
        assertThat(memoryActions).hasSize(2);
        assertThat(memoryActions.get(0).getData().get("memories")).isNotNull();
    }

    @Test
    void invalidRefinementProposalsAreDroppedWithoutTouchingData() {
        Schedule schedule = schedule(OWNER, "Invalid refine");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"type":"BAD_TYPE","content":"无效类型","importance":9},
                             {"type":"GOAL","content":"","importance":3}],
                 "profile":{"unknownField":"越权字段","name":123}}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "随便聊聊"), OWNER);

        assertThat(response.getActions()).noneMatch(a -> "SAVE_MEMORY".equals(a.getType()));
        assertThat(response.getActions()).noneMatch(a -> "UPDATE_PROFILE".equals(a.getType()));
        // 主回复的课程提案不受提炼失败影响
        assertThat(response.getActions()).anyMatch(a -> "CREATE_COURSE".equals(a.getType()));
        assertThat(memories.selectCount(null)).isZero();
        assertThat(profiles.selectCount(null)).isZero();
    }

    @Test
    void memoryDataChangeMarksPendingMemoryProposalStale() {
        Schedule schedule = schedule(OWNER, "Stale memory");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试","importance":5}]}
                """);
        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "我报了六级"), OWNER);
        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "SAVE_MEMORY".equals(a.getType())).findFirst().orElseThrow();

        // 用户在设置页手动新增一条记忆 → 记忆域数据变化
        memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯晚饭后散步", 2, Memory.SOURCE_USER, null);

        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(409);
        assertThat(actions.selectById(proposal.getActionId()).getActionStatus()).isEqualTo("STALE");
        assertThat(memoryService.listActive(OWNER)).hasSize(1);
        assertThat(memoryService.listActive(OWNER).get(0).getSource()).isEqualTo(Memory.SOURCE_USER);
    }

    @Test
    void rereadingHistoryShowsStaleProposalWithoutPersistingIt() {
        Schedule schedule = schedule(OWNER, "Display stale memory");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"type":"GOAL","content":"准备 12 月六级","importance":5}]}
                """);
        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "我报了六级"), OWNER);
        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "SAVE_MEMORY".equals(a.getType())).findFirst().orElseThrow();
        assertThat(proposal.getStatus()).isEqualTo("PENDING");

        // 用户手动改了记忆 → 重新打开对话时，这张待确认卡片应显示为「已失效」
        memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯晚饭后散步", 2, Memory.SOURCE_USER, null);

        AiMessageResponse reread = ai.listMessages(conversation.getId(), OWNER).stream()
                .filter(m -> m.getMessageId().equals(response.getMessageId())).findFirst().orElseThrow();
        AiActionDto shown = reread.getActions().stream()
                .filter(a -> a.getActionId().equals(proposal.getActionId())).findFirst().orElseThrow();
        assertThat(shown.getStatus())
                .as("展示态复核：数据已变，卡片先提示失效，用户不必点了才知道")
                .isEqualTo("STALE");
        // 只是展示态，落库仍然是 PENDING——真正失效仍发生在执行那一刻
        assertThat(actions.selectById(proposal.getActionId()).getActionStatus()).isEqualTo("PENDING");
        assertThat(memoryService.listActive(OWNER)).hasSize(1);
    }

    @Test
    void profileDataChangeMarksPendingProfileProposalStale() {
        Schedule schedule = schedule(OWNER, "Stale profile");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"), """
                {"profile":{"major":"软件工程"}}
                """);
        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "我是软件工程专业的"), OWNER);
        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "UPDATE_PROFILE".equals(a.getType())).findFirst().orElseThrow();

        // 用户先在设置页改了档案 → 档案域数据变化
        StudentProfilePatch patch = new StudentProfilePatch();
        patch.setGoal("考研上岸");
        studentProfileService.applyPatch(OWNER, patch, StudentProfile.UPDATED_BY_USER);

        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(409);
        assertThat(actions.selectById(proposal.getActionId()).getActionStatus()).isEqualTo("STALE");
        StudentProfile profile = studentProfileService.find(OWNER);
        assertThat(profile.getMajor()).isNull();
        assertThat(profile.getGoal()).isEqualTo("考研上岸");
    }

    @Test
    void refinementFailureDoesNotBreakMainReply() {
        Schedule schedule = schedule(OWNER, "Refine down");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn(createCourseJson("高等数学"))
                .thenThrow(new RuntimeException("upstream unavailable"));

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "帮我加一门高数"), OWNER);

        assertThat(response.getActions()).anyMatch(a -> "CREATE_COURSE".equals(a.getType()));
        assertThat(memories.selectCount(null)).isZero();
    }

    // ==================== 辅助 ====================

    private AiMessageRequest request(Long scheduleId, String content) {
        AiMessageRequest request = new AiMessageRequest();
        request.setScheduleId(scheduleId);
        request.setContent(content);
        return request;
    }

    private Schedule schedule(String key, String name) {
        ScheduleRequest request = new ScheduleRequest();
        request.setName(name);
        request.setPeriodStartDate(java.time.LocalDate.of(2026, 9, 7));
        request.setPeriodEndDate(java.time.LocalDate.of(2027, 1, 31));
        return schedules.create(request, key);
    }

    private AiConversation conversation(Long scheduleId) {
        AiConversationRequest request = new AiConversationRequest();
        request.setScheduleId(scheduleId);
        return ai.createConversation(request, OWNER);
    }

    private static String createCourseJson(String name) {
        return "{\"text\":\"Proposed\",\"actions\":[{\"type\":\"CREATE_COURSE\",\"data\":{\"courses\":[{\"name\":\""
                + name + "\",\"dayOfWeek\":1,\"startPeriod\":1,\"endPeriod\":2,\"weeks\":[1]}]}}]}";
    }
}
