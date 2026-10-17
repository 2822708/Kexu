package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.service.LlmBudgetService;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.AiActionDto;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.ScheduleRequest;
import com.timetable.dto.TaskDraft;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Schedule;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.TaskMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.LlmUsageRecorder;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.RequestValidationService;
import com.timetable.service.ScheduleService;
import com.timetable.service.TaskService;
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
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * AI Campus Agent V1.0 Step 5：任务 CRUD + TASK 作用域提案（CREATE_TASK/UPDATE_TASK）。
 *
 * 与 AiCampusAgentChatTest 同一模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。
 */
@ActiveProfiles("campus-agent-task")
@SpringBootTest(classes = AiCampusAgentTaskTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_task;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentTaskTest {

    private static final String OWNER = "task-owner";
    private static final String OTHER = "task-other";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-task")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, AiServiceImpl.class,
            StudentProfileServiceImpl.class, MemoryServiceImpl.class, TaskServiceImpl.class,
            LlmClientRegistry.class, LlmProperties.class, LlmBudgetService.class, LlmBudgetProperties.class, LlmPricingProperties.class, PromptTemplateRegistry.class, AiEventRecorder.class, LlmUsageRecorder.class })
    static class TestApplication {
        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-09-27T02:06:00Z"), ZoneId.of("Asia/Shanghai"));
        }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired AiService ai;
    @Autowired TaskService taskService;
    @Autowired TaskMapper taskMapper;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Task owner");
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OTHER, "Task other");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void createTaskProposalExecutesWithAiParseSourceAndSourceRef() {
        Schedule schedule = schedule(OWNER, "Create task");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn("""
                {"text":"已为你生成任务提案，确认后创建。","actions":[
                  {"type":"CREATE_TASK","data":{"tasks":[
                    {"title":"提交高等数学第三次作业","type":"COURSE_WORK","deadline":"2026-10-15 23:59","priority":1,"description":"提交到学习通"}]}}]}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "帮我加个任务：10 月 15 日前提交高数第三次作业到学习通"), OWNER);

        List<AiActionDto> proposals = response.getActions().stream()
                .filter(a -> "CREATE_TASK".equals(a.getType())).toList();
        assertThat(proposals).hasSize(1);
        assertThat(proposals.get(0).getScope()).isEqualTo("TASK");
        assertThat(proposals.get(0).getStatus()).isEqualTo("PENDING");
        // 提案阶段不落库（human-in-the-loop）
        assertThat(taskMapper.selectCount(null)).isZero();

        ai.executeAction(conversation.getId(), proposals.get(0).getActionId(), OWNER);

        List<Task> stored = taskMapper.selectList(null);
        assertThat(stored).hasSize(1);
        Task task = stored.get(0);
        assertThat(task.getApiKey()).isEqualTo(OWNER);
        assertThat(task.getTitle()).isEqualTo("提交高等数学第三次作业");
        assertThat(task.getType()).isEqualTo(Task.TYPE_COURSE_WORK);
        assertThat(task.getDeadline()).isEqualTo(LocalDateTime.of(2026, 10, 15, 23, 59));
        assertThat(task.getPriority()).isEqualTo(1);
        assertThat(task.getStatus()).isEqualTo(Task.STATUS_PENDING);
        assertThat(task.getSource()).isEqualTo(Task.SOURCE_AI_PARSE);
        // sourceRef 指向触发它的 assistant 消息，便于审计与追溯
        assertThat(task.getSourceRef()).isEqualTo("message:" + response.getMessageId());
    }

    @Test
    void updateTaskProposalCarriesBeforeSnapshotAndExecutes() {
        Schedule schedule = schedule(OWNER, "Update task");
        AiConversation conversation = conversation(schedule.getId());
        Task seeded = taskService.create(OWNER,
                draft("整理竞赛报名材料", Task.TYPE_COMPETITION, null, 2, ""), Task.SOURCE_MANUAL);
        when(provider.chatJson(any(), any())).thenReturn("""
                {"text":"已生成修改提案。","actions":[
                  {"type":"UPDATE_TASK","data":{"tasks":[
                    {"id":%d,"title":"整理数学建模竞赛报名材料","type":"COMPETITION","deadline":"2026-10-20 09:30","priority":1,"description":"注意截止当天不收"}]}}]}
                """.formatted(seeded.getId()));

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "把整理竞赛报名材料改成高优先级，10 月 20 日上午截止"), OWNER);

        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "UPDATE_TASK".equals(a.getType())).findFirst().orElseThrow();
        assertThat(proposal.getScope()).isEqualTo("TASK");
        // _before 快照：前端 diff 展示与撤销的依据
        assertThat(proposal.getData().get("_before")).isNotNull();
        assertThat(proposal.getData().get("_before").get(0).get("title").asText())
                .isEqualTo("整理竞赛报名材料");

        ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER);

        Task updated = taskService.get(seeded.getId(), OWNER);
        assertThat(updated.getTitle()).isEqualTo("整理数学建模竞赛报名材料");
        assertThat(updated.getDeadline()).isEqualTo(LocalDateTime.of(2026, 10, 20, 9, 30));
        assertThat(updated.getPriority()).isEqualTo(1);
        assertThat(updated.getDescription()).isEqualTo("注意截止当天不收");
        assertThat(updated.getSource()).isEqualTo(Task.SOURCE_MANUAL); // 来源不被 AI 修改覆盖
    }

    @Test
    void updateTaskProposalCanTransitionStatus() {
        Schedule schedule = schedule(OWNER, "Status task");
        AiConversation conversation = conversation(schedule.getId());
        Task seeded = taskService.create(OWNER,
                draft("完成 MOOC 第二章测试", Task.TYPE_ONLINE_COURSE, null, 2, ""), Task.SOURCE_MANUAL);
        when(provider.chatJson(any(), any())).thenReturn("""
                {"text":"已标记完成提案。","actions":[
                  {"type":"UPDATE_TASK","data":{"tasks":[
                    {"id":%d,"title":"完成 MOOC 第二章测试","type":"ONLINE_COURSE","deadline":null,"priority":2,"description":"","status":"DONE"}]}}]}
                """.formatted(seeded.getId()));

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "MOOC 第二章测试做完了"), OWNER);

        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "UPDATE_TASK".equals(a.getType())).findFirst().orElseThrow();
        ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER);

        assertThat(taskService.get(seeded.getId(), OWNER).getStatus()).isEqualTo(Task.STATUS_DONE);
        // 已完成的任务不再进入聊天上下文与 Dashboard 今日任务
        assertThat(taskService.listOpen(OWNER, LocalDateTime.of(2026, 9, 27, 10, 0))).isEmpty();
    }

    @Test
    void taskDataChangeMarksPendingTaskProposalStale() {
        Schedule schedule = schedule(OWNER, "Stale task");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn("""
                {"text":"已生成任务提案。","actions":[
                  {"type":"CREATE_TASK","data":{"tasks":[{"title":"准备英语口语展示","type":"OTHER","deadline":null,"priority":2,"description":""}]}}]}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "加个任务：准备英语口语展示"), OWNER);
        AiActionDto proposal = response.getActions().stream()
                .filter(a -> "CREATE_TASK".equals(a.getType())).findFirst().orElseThrow();

        // 用户在页面手动改了什么 → TASK 作用域指纹变化 → 提案失效
        taskService.create(OWNER,
                draft("手动添加的任务", Task.TYPE_OTHER, null, 2, ""), Task.SOURCE_MANUAL);

        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), proposal.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("任务");
        assertThat(taskMapper.selectCount(new LambdaQueryWrapper<Task>()
                .eq(Task::getApiKey, OWNER).eq(Task::getTitle, "准备英语口语展示"))).isZero();
    }

    @Test
    void taskScopeIsIndependentFromTodoScope() {
        Schedule schedule = schedule(OWNER, "Scope split");
        AiConversation conversation = conversation(schedule.getId());
        when(provider.chatJson(any(), any())).thenReturn("""
                {"text":"两件事都提案了。","actions":[
                  {"type":"CREATE_TASK","data":{"tasks":[{"title":"写实验报告","type":"LAB_REPORT","deadline":null,"priority":2,"description":""}]}},
                  {"type":"CREATE_TODO","data":{"todos":[{"title":"记得带校园卡","ddl":"2026-09-28 08:00"}]}}]}
                """);

        AiMessageResponse response = ai.sendMessage(conversation.getId(),
                request(schedule.getId(), "加个写实验报告的任务，再加个明天带校园卡的待办"), OWNER);
        AiActionDto taskProposal = response.getActions().stream()
                .filter(a -> "CREATE_TASK".equals(a.getType())).findFirst().orElseThrow();
        AiActionDto todoProposal = response.getActions().stream()
                .filter(a -> "CREATE_TODO".equals(a.getType())).findFirst().orElseThrow();

        // 手动改任务只让 TASK 作用域失效，TODO 提案不受影响
        taskService.create(OWNER,
                draft("手动任务", Task.TYPE_OTHER, null, 2, ""), Task.SOURCE_MANUAL);

        // TODO 提案仍可执行（作用域隔离：任务数据变化不波及待办提案）
        ai.executeAction(conversation.getId(), todoProposal.getActionId(), OWNER);
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM todo WHERE api_key=? AND title=?",
                Integer.class, OWNER, "记得带校园卡")).isEqualTo(1);

        // TASK 提案则因数据变化失效，不会写入
        assertThatThrownBy(() -> ai.executeAction(conversation.getId(), taskProposal.getActionId(), OWNER))
                .isInstanceOf(BusinessException.class);
        assertThat(taskMapper.selectCount(new LambdaQueryWrapper<Task>()
                .eq(Task::getApiKey, OWNER).eq(Task::getTitle, "写实验报告"))).isZero();
    }

    @Test
    void taskCrudLifecycleWithOwnershipChecks() {
        Task created = taskService.create(OWNER,
                draft("提交高等数学第三次作业", Task.TYPE_COURSE_WORK,
                        LocalDateTime.of(2026, 10, 15, 23, 59), 1, "提交到学习通"),
                Task.SOURCE_MANUAL);
        assertThat(created.getStatus()).isEqualTo(Task.STATUS_PENDING);

        // 归属隔离：他人读写一律 404
        assertThatThrownBy(() -> taskService.get(created.getId(), OTHER))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("任务不存在");
        assertThatThrownBy(() -> taskService.update(created.getId(),
                draft("篡改", Task.TYPE_OTHER, null, 2, ""), OTHER))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> taskService.updateStatus(created.getId(), "DONE", OTHER))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> taskService.delete(created.getId(), OTHER))
                .isInstanceOf(BusinessException.class);

        // 列表：按截止升序、无截止排后
        taskService.create(OWNER, draft("无截止任务", Task.TYPE_OTHER, null, 3, ""), Task.SOURCE_MANUAL);
        taskService.create(OWNER, draft("更早截止", Task.TYPE_EXAM,
                LocalDateTime.of(2026, 10, 1, 8, 0), 2, ""), Task.SOURCE_MANUAL);
        List<Task> list = taskService.list(OWNER);
        assertThat(list).extracting(Task::getTitle)
                .containsExactly("更早截止", "提交高等数学第三次作业", "无截止任务");

        // 筛选：状态/类型/截止窗口
        assertThat(taskService.list(OWNER, "PENDING", null, null, null)).hasSize(3);
        assertThat(taskService.list(OWNER, null, "EXAM", null, null))
                .extracting(Task::getTitle).containsExactly("更早截止");
        assertThat(taskService.list(OWNER, null, null,
                LocalDateTime.of(2026, 10, 10, 0, 0), null))
                .extracting(Task::getTitle).containsExactly("更早截止");
        assertThatThrownBy(() -> taskService.list(OWNER, "FLYING", null, null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("不支持的任务状态");

        // 修改：补丁语义
        TaskDraft patch = new TaskDraft();
        patch.setTitle("提交高等数学第三次作业（修订）");
        patch.setDeadline(null); // 显式清除截止
        patch.setDescription(""); // 显式清除描述
        Task updated = taskService.update(created.getId(), patch, OWNER);
        assertThat(updated.getTitle()).isEqualTo("提交高等数学第三次作业（修订）");
        assertThat(updated.getDeadline()).isNull();
        assertThat(updated.getDescription()).isNull();
        assertThat(updated.getType()).isEqualTo(Task.TYPE_COURSE_WORK); // 未提供的字段保持原值
        assertThat(updated.getPriority()).isEqualTo(1);
        assertThat(updated.getUpdatedAt()).isAfter(created.getUpdatedAt());

        // 状态流转
        assertThat(taskService.updateStatus(created.getId(), "IN_PROGRESS", OWNER).getStatus())
                .isEqualTo(Task.STATUS_IN_PROGRESS);
        assertThatThrownBy(() -> taskService.updateStatus(created.getId(), "MAYBE", OWNER))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("不支持的任务状态");

        // 删除
        taskService.delete(created.getId(), OWNER);
        assertThatThrownBy(() -> taskService.get(created.getId(), OWNER))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void createTaskRejectsInvalidDrafts() {
        assertThatThrownBy(() -> taskService.create(OWNER,
                draft("  ", Task.TYPE_OTHER, null, 2, ""), Task.SOURCE_MANUAL))
                .isInstanceOf(BusinessException.class).hasMessageContaining("标题");
        assertThatThrownBy(() -> taskService.create(OWNER,
                draft("正常标题", "MAILMAN", null, 2, ""), Task.SOURCE_MANUAL))
                .isInstanceOf(BusinessException.class).hasMessageContaining("类型");
        assertThatThrownBy(() -> taskService.create(OWNER,
                draft("正常标题", Task.TYPE_OTHER, null, 9, ""), Task.SOURCE_MANUAL))
                .isInstanceOf(BusinessException.class).hasMessageContaining("优先级");
        assertThat(taskMapper.selectCount(null)).isZero();
    }

    // ==================== 辅助 ====================

    private TaskDraft draft(String title, String type, LocalDateTime deadline, int priority, String description) {
        TaskDraft draft = new TaskDraft();
        draft.setTitle(title);
        draft.setType(type);
        draft.setDeadline(deadline);
        draft.setPriority(priority);
        draft.setDescription(description);
        return draft;
    }

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
}
