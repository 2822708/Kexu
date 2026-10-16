package com.timetable.service.impl;

import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.ScheduleRequest;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Memory;
import com.timetable.entity.Schedule;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.LlmUsageRecorder;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.MemoryService;
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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Step 7 回滚开关：{@code app.ai.memory-refine-enabled=false}。
 *
 * 关闭后只停提炼——对话、课表提案与已有记忆的上下文注入都不受影响，
 * 因此线上出问题时可以一键退回 Step 6 的行为，不需要回滚数据。
 */
@ActiveProfiles("campus-agent-memory-off")
@SpringBootTest(classes = AiCampusAgentMemoryRefineSwitchTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_memory_off;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "app.ai.memory-refine-enabled=false",
        "logging.level.com.timetable=WARN"
})
class AiCampusAgentMemoryRefineSwitchTest {

    private static final String OWNER = "memory-off-owner";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-memory-off")
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
    @Autowired MemoryService memoryService;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Off owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void disabledSwitchSkipsRefinementButKeepsChatAndContext() {
        Schedule schedule = schedule(OWNER, "Off");
        AiConversation conversation = conversation(schedule.getId());
        memoryService.create(OWNER, Memory.TYPE_GOAL, "准备 12 月 CET-6 考试", 5, Memory.SOURCE_USER, null);
        when(provider.chatJson(any(), any())).thenReturn("{\"text\":\"好的\",\"actions\":[]}");

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "帮我加一门高数"), OWNER);

        // 主回复照常；模型只被调用一次（没有额外的提炼调用），也不产生记忆提案
        assertThat(response.getText()).isEqualTo("好的");
        assertThat(response.getActions()).isEmpty();
        verify(provider, times(1)).chatJson(any(), any());
        // 已有记忆照常进入上下文
        assertThat(ai.contextSummary(conversation.getId(), OWNER).getMemoryCount()).isEqualTo(1);
        assertThat(memoryService.listActive(OWNER)).hasSize(1);
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
        request.setPeriodStartDate(LocalDate.of(2026, 9, 7));
        request.setPeriodEndDate(LocalDate.of(2027, 1, 31));
        return schedules.create(request, key);
    }

    private AiConversation conversation(Long scheduleId) {
        AiConversationRequest request = new AiConversationRequest();
        request.setScheduleId(scheduleId);
        return ai.createConversation(request, OWNER);
    }
}
