package com.timetable.service.impl;

import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.AiActionDto;
import com.timetable.dto.AiContextSummary;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.ScheduleRequest;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Memory;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.MemoryMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * AI Campus Agent V1.0 Step 7：长期记忆治理。
 *
 * 与既有 Campus Agent 测试同一模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。重点固化四条验收标准：
 * 同一事实反复提炼只留一条 ACTIVE、修正走 UPDATE 而非新增、
 * 手动编辑/删除即时生效、容量到顶即拒绝新增。
 */
@ActiveProfiles("campus-agent-memory")
@SpringBootTest(classes = AiCampusAgentMemoryTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_memory;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentMemoryTest {

    private static final String OWNER = "memory-owner";
    private static final String OTHER = "memory-other";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-memory")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, AiServiceImpl.class,
            StudentProfileServiceImpl.class, MemoryServiceImpl.class, TaskServiceImpl.class,
            LlmClientRegistry.class, LlmProperties.class, PromptTemplateRegistry.class})
    static class TestApplication {
        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-09-27T02:06:00Z"), ZoneId.of("Asia/Shanghai"));
        }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired AiService ai;
    @Autowired MemoryMapper memories;
    @Autowired MemoryService memoryService;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Memory owner");
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OTHER, "Memory other");
        when(provider.isConfigured()).thenReturn(true);
    }

    // ==================== 同一事实只留一条 ====================

    @Test
    void sameFactRefinedThreeTimesKeepsSingleActiveMemory() {
        Schedule schedule = schedule(OWNER, "Repeat");
        AiConversation conversation = conversation(schedule.getId());
        // 三轮都聊同一件事，模型（不听话地）每轮都输出 ADD，内容只有标点/空格差异
        when(provider.chatJson(any())).thenReturn(
                createCourseJson("高等数学"),
                """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试","importance":5}]}
                """,
                createCourseJson("高等数学"),
                """
                {"memories":[{"type":"GOAL","content":"准备12月CET-6考试！","importance":5}]}
                """,
                createCourseJson("高等数学"),
                """
                {"memories":[{"type":"GOAL","content":"准备 12 月 CET-6 考试。","importance":3}]}
                """);

        for (int round = 1; round <= 3; round++) {
            AiMessageResponse response = ai.sendMessage(conversation.getId(),
                    request(schedule.getId(), "我报了 12 月的六级"), OWNER);
            List<AiActionDto> proposals = response.getActions().stream()
                    .filter(a -> "SAVE_MEMORY".equals(a.getType())).toList();
            assertThat(proposals).as("第 %d 轮应产出记忆提案", round).hasSize(1);
            ai.executeAction(conversation.getId(), proposals.get(0).getActionId(), OWNER);
        }

        List<Memory> stored = memoryService.listActive(OWNER);
        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getContent()).isEqualTo("准备 12 月 CET-6 考试");
        // 反复提及只说明它更重要，不该把重要度拉回去
        assertThat(stored.get(0).getImportance()).isEqualTo(5);
        assertThat(memories.selectCount(null)).isEqualTo(1);
    }

    @Test
    void updateProposalRewritesExistingMemoryInsteadOfAdding() {
        Schedule schedule = schedule(OWNER, "Update");
        AiConversation conversation = conversation(schedule.getId());
        Memory seeded = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备考研", 3, Memory.SOURCE_AI, null);
        when(provider.chatJson(any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"action":"UPDATE","target_id":%d,"type":"GOAL",
                  "content":"准备 26 年考研","importance":4}]}
                """.formatted(seeded.getId()));

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "其实是 26 年考研"), OWNER);
        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "SAVE_MEMORY".equals(a.getType())).findFirst().orElseThrow();
        ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER);

        List<Memory> stored = memoryService.listActive(OWNER);
        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getId()).isEqualTo(seeded.getId());
        assertThat(stored.get(0).getContent()).isEqualTo("准备 26 年考研");
        assertThat(stored.get(0).getImportance()).isEqualTo(4);
        assertThat(memories.selectCount(null)).isEqualTo(1);
    }

    @Test
    void updateWithUnusableTargetProducesNoProposal() {
        Schedule schedule = schedule(OWNER, "Bad target");
        AiConversation conversation = conversation(schedule.getId());
        Memory mine = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备考研", 3, Memory.SOURCE_AI, null);
        Memory foreign = memoryService.create(OTHER, Memory.TYPE_GOAL, "别人的目标", 3, Memory.SOURCE_AI, null);

        // 指向不存在的 id
        when(provider.chatJson(any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"action":"UPDATE","target_id":999999,"type":"GOAL",
                  "content":"不存在","importance":4}]}
                """);
        AiMessageResponse missing = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "改一下"), OWNER);
        assertThat(missing.getActions()).noneMatch(a -> "SAVE_MEMORY".equals(a.getType()));

        // 指向他人账号下的记忆
        when(provider.chatJson(any())).thenReturn(createCourseJson("高等数学"), """
                {"memories":[{"action":"UPDATE","target_id":%d,"type":"GOAL",
                  "content":"越权改写","importance":4}]}
                """.formatted(foreign.getId()));
        AiMessageResponse crossTenant = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "再改一下"), OWNER);
        assertThat(crossTenant.getActions()).noneMatch(a -> "SAVE_MEMORY".equals(a.getType()));

        assertThat(memoryService.listActive(OWNER)).hasSize(1);
        assertThat(memoryService.listActive(OWNER).get(0).getContent()).isEqualTo("准备考研");
        assertThat(memoryService.listActive(OTHER).get(0).getId()).isEqualTo(foreign.getId());
        assertThat(memoryService.getById(foreign.getId(), OTHER).getContent()).isEqualTo("别人的目标");
        assertThat(mine.getId()).isNotNull();
    }

    // ==================== 上下文注入与 top-N ====================

    @Test
    void onlyTopMemoriesEnterContextAndRestAreReportedTruncated() {
        Schedule schedule = schedule(OWNER, "TopN");
        AiConversation conversation = conversation(schedule.getId());
        for (int i = 0; i < 25; i++) {
            memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯 " + i, 5 - (i / 5),
                    Memory.SOURCE_USER, null);
        }
        assertThat(memoryService.listTopActive(OWNER, AiPromptBuilder.MAX_MEMORIES))
                .hasSize(AiPromptBuilder.MAX_MEMORIES)
                .allSatisfy(m -> assertThat(m.getImportance()).isGreaterThanOrEqualTo(2));

        AiContextSummary summary = ai.contextSummary(conversation.getId(), OWNER);
        assertThat(summary.getMemoryCount()).isEqualTo(AiPromptBuilder.MAX_MEMORIES);
        assertThat(summary.isMemoriesTruncated()).isTrue();
    }

    @Test
    void sameImportancePrefersRecentlyUpdated() {
        Memory first = memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯早睡", 3, Memory.SOURCE_USER, null);
        Memory second = memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯复盘", 3, Memory.SOURCE_USER, null);
        assertThat(memoryService.listActive(OWNER)).extracting(Memory::getId)
                .containsExactlyInAnyOrder(first.getId(), second.getId());

        // 重要度相同时，最近被提及/修正的那条更值得注入：更新 first 后它排到前面
        memoryService.update(first.getId(), OWNER, null, null, 3);
        memoryService.update(second.getId(), OWNER, null, null, 3);
        assertThat(memoryService.listActive(OWNER)).extracting(Memory::getId)
                .containsExactly(second.getId(), first.getId());
    }

    // ==================== 手动治理 ====================

    @Test
    void manualEditArchiveAndDeleteTakeEffectImmediately() {
        Memory created = memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯晚饭后散步", 2,
                Memory.SOURCE_USER, null);

        // 局部更新：type 不传保持原值，content/importance 覆盖
        Memory updated = memoryService.update(created.getId(), OWNER, null, "习惯晚自习后跑步", 4);
        assertThat(updated.getType()).isEqualTo(Memory.TYPE_HABIT);
        assertThat(updated.getContent()).isEqualTo("习惯晚自习后跑步");
        assertThat(updated.getImportance()).isEqualTo(4);
        assertThat(memoryService.listActive(OWNER)).hasSize(1);

        // 归档：不再进入上下文，但保留审计痕迹
        memoryService.supersede(created.getId(), OWNER);
        assertThat(memoryService.listActive(OWNER)).isEmpty();
        assertThat(memoryService.countActive(OWNER)).isZero();
        assertThat(memories.selectCount(null)).isEqualTo(1);

        // 删除：彻底移除
        memoryService.delete(created.getId(), OWNER);
        assertThat(memories.selectCount(null)).isZero();
    }

    @Test
    void manualOperationsRejectForeignOrMissingMemory() {
        Memory mine = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备考研", 3, Memory.SOURCE_USER, null);

        assertThatThrownBy(() -> memoryService.getById(mine.getId(), OTHER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(404);
        assertThatThrownBy(() -> memoryService.update(mine.getId(), OTHER, null, "越权", null))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(404);
        assertThatThrownBy(() -> memoryService.delete(mine.getId(), OTHER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(404);
        assertThatThrownBy(() -> memoryService.supersede(4242L, OWNER))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(404);
        assertThat(memoryService.getById(mine.getId(), OWNER).getContent()).isEqualTo("准备考研");
    }

    @Test
    void duplicateManualAddIsMergedAndImportanceNeverDrops() {
        Memory first = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备 12 月 CET-6 考试", 2,
                Memory.SOURCE_USER, null);
        Memory second = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备12月CET-6考试！", 5,
                Memory.SOURCE_USER, null);
        assertThat(second.getId()).isEqualTo(first.getId());
        assertThat(memoryService.listActive(OWNER)).hasSize(1);

        Memory third = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备 12 月 CET-6 考试。", 1,
                Memory.SOURCE_USER, null);
        assertThat(third.getImportance()).isEqualTo(5);
        assertThat(memories.selectCount(null)).isEqualTo(1);
    }

    @Test
    void editingIntoExistingMemoryIsRejectedInsteadOfCreatingCopy() {
        Memory goal = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备考研", 3, Memory.SOURCE_USER, null);
        Memory twin = memoryService.create(OWNER, Memory.TYPE_GOAL, "准备考公", 3, Memory.SOURCE_USER, null);

        assertThatThrownBy(() -> memoryService.update(twin.getId(), OWNER, null, "准备考研", null))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(409);
        assertThat(memoryService.getById(twin.getId(), OWNER).getContent()).isEqualTo("准备考公");
        assertThat(memoryService.listActive(OWNER)).hasSize(2);
        assertThat(goal.getId()).isNotEqualTo(twin.getId());
    }

    @Test
    void capacityGuardRejectsMemoriesBeyondLimit() {
        for (int i = 0; i < MemoryService.MAX_ACTIVE_MEMORIES; i++) {
            memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯 " + i, 3, Memory.SOURCE_USER, null);
        }
        assertThat(memoryService.countActive(OWNER)).isEqualTo(MemoryService.MAX_ACTIVE_MEMORIES);

        assertThatThrownBy(() -> memoryService.create(OWNER, Memory.TYPE_HABIT, "再多一条", 3,
                Memory.SOURCE_USER, null))
                .isInstanceOf(BusinessException.class).extracting("code").isEqualTo(409);
        // 归档腾出空间后可以继续写入
        memoryService.supersede(memoryService.listActive(OWNER).get(0).getId(), OWNER);
        assertThat(memoryService.create(OWNER, Memory.TYPE_HABIT, "再多一条", 3, Memory.SOURCE_USER, null))
                .isNotNull();
    }

    @Test
    void normalizeIgnoresPunctuationWhitespaceAndCase() {
        assertThat(memoryService.normalize("准备 12 月 CET-6 考试！"))
                .isEqualTo(memoryService.normalize("准备12月cet6考试"));
        assertThat(memoryService.normalize(null)).isEmpty();
        // 不同事实不会被合并
        assertThat(memoryService.normalize("准备考研"))
                .isNotEqualTo(memoryService.normalize("准备考公"));
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

    private static String createCourseJson(String name) {
        return "{\"text\":\"Proposed\",\"actions\":[{\"type\":\"CREATE_COURSE\",\"data\":{\"courses\":[{\"name\":\""
                + name + "\",\"dayOfWeek\":1,\"startPeriod\":1,\"endPeriod\":2,\"weeks\":[1]}]}}]}";
    }
}
