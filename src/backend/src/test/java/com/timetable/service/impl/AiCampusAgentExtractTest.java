package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.TaskDraft;
import com.timetable.dto.TaskExtractRequest;
import com.timetable.dto.TaskExtractResult;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.TaskMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.RequestValidationService;
import com.timetable.service.TaskService;
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
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI Campus Agent V1.0 Step 4：材料 → 任务草稿抽取 + 草稿批量落库。
 *
 * 与 AiCampusAgentChatTest 同一模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。Prompt 模板来自 classpath（真实加载）。
 */
@ActiveProfiles("campus-agent-extract")
@SpringBootTest(classes = AiCampusAgentExtractTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_extract;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentExtractTest {

    private static final String OWNER = "extract-owner";
    private static final String OTHER = "extract-other";
    /** 1x1 PNG，魔数真实，用于走通截图路径的格式/签名校验。 */
    private static final String PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
            + "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-extract")
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
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Extract owner");
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OTHER, "Extract other");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void extractTasksFromCourseNoticeTextBuildsEditableDrafts() {
        String material = "高等数学（下）课程通知：\n"
                + "1. 第三次作业请于 10 月 15 日 23:59 前提交到学习通；\n"
                + "2. 实验报告《线性方程组求解》10 月 8 日截止；\n"
                + "3. 期中考试安排待教务处后续通知。";
        when(provider.chatJson(any())).thenReturn("""
                {"tasks":[
                  {"title":"提交高等数学第三次作业","type":"COURSE_WORK","deadline":"2026-10-15 23:59","priority":1,"description":"提交到学习通平台"},
                  {"title":"提交线性方程组求解实验报告","type":"LAB_REPORT","deadline":"2026-10-08 23:59","priority":2,"description":""}
                ],"confidence":0.92}""");

        TaskExtractResult result = ai.extractTasks(textRequest(material), OWNER);

        assertThat(result.getTasks()).hasSize(2);
        TaskDraft first = result.getTasks().get(0);
        assertThat(first.getTitle()).isEqualTo("提交高等数学第三次作业");
        assertThat(first.getType()).isEqualTo("COURSE_WORK");
        assertThat(first.getDeadline()).isEqualTo(LocalDateTime.of(2026, 10, 15, 23, 59));
        assertThat(first.getPriority()).isEqualTo(1);
        assertThat(first.getDescription()).isEqualTo("提交到学习通平台");
        assertThat(result.getTasks().get(1).getDeadline()).isEqualTo(LocalDateTime.of(2026, 10, 8, 23, 59));
        assertThat(result.getConfidence()).isEqualTo(0.92);

        List<LlmClient.Message> payload = captureSingleCall();
        assertThat(payload.get(0).getRole()).isEqualTo("system");
        assertThat(payload.get(0).getContent()).contains("任务抽取器").contains("当前日期：2026-09-27");
        assertThat(payload.get(1).getRole()).isEqualTo("user");
        assertThat(payload.get(1).getContent()).isEqualTo(material);
        assertThat(payload.get(1).getImageDataUrl()).isNull();
    }

    @Test
    void extractTasksFromScreenshotSendsImageToVisionModel() {
        when(provider.chatJson(any())).thenReturn("""
                {"tasks":[{"title":"完成 MOOC 第二章测试","type":"ONLINE_COURSE","deadline":null,"priority":2,"description":""}],"confidence":0.7}""");

        TaskExtractResult result = ai.extractTasks(imageRequest(PNG_DATA_URL), OWNER);

        assertThat(result.getTasks()).hasSize(1);
        assertThat(result.getTasks().get(0).getDeadline()).isNull();
        assertThat(result.getTasks().get(0).getType()).isEqualTo("ONLINE_COURSE");

        List<LlmClient.Message> payload = captureSingleCall();
        assertThat(payload.get(0).getContent()).contains("任务抽取器");
        assertThat(payload.get(1).getImageDataUrl()).isEqualTo(PNG_DATA_URL);
        assertThat(payload.get(1).getContent()).contains("图片");
    }

    @Test
    void extractTasksCleansInvalidFieldsWithoutGuessingDeadlines() {
        String longTitle = "题".repeat(60);
        String longDescription = "述".repeat(260);
        when(provider.chatJson(any())).thenReturn("""
                {"tasks":[
                  {"title":"","type":"COURSE_WORK","deadline":"2026-10-01 12:00","priority":1,"description":"空标题应被丢弃"},
                  {"title":"提交密码学作业","type":"MAILMAN","deadline":"2026-09-20 23:59","priority":1,"description":"过去的截止时间必须作废"},
                  {"title":"准备英语演讲","type":"OTHER","deadline":"下周五之前","priority":99,"description":"无法解析的时间"},
                  {"title":"整理竞赛报名材料","type":"COMPETITION","deadline":"2026-10-20T09:30","priority":0,"description":""},
                  {"title":"%s","type":"EXAM","deadline":null,"description":"%s"}
                ],"confidence":1.7}""".formatted(longTitle, longDescription));

        TaskExtractResult result = ai.extractTasks(textRequest("密码学第四次作业 10 月 1 日 12:00 截止……"), OWNER);

        // 空标题那条被整条丢弃，其余 4 条清洗后保留
        assertThat(result.getTasks()).hasSize(4);
        TaskDraft crypto = result.getTasks().get(0);
        assertThat(crypto.getTitle()).isEqualTo("提交密码学作业");
        assertThat(crypto.getType()).isEqualTo("OTHER");   // 白名单外归 OTHER
        assertThat(crypto.getDeadline()).isNull();          // 早于当天的截止时间作废，不猜新的
        TaskDraft speech = result.getTasks().get(1);
        assertThat(speech.getDeadline()).isNull();          // 无法解析 → null，严禁猜测
        assertThat(speech.getPriority()).isEqualTo(3);      // 99 钳制到 3
        TaskDraft competition = result.getTasks().get(2);
        assertThat(competition.getDeadline()).isEqualTo(LocalDateTime.of(2026, 10, 20, 9, 30)); // ISO T 分隔也认
        assertThat(competition.getPriority()).isEqualTo(1); // 0 钳制到 1
        TaskDraft exam = result.getTasks().get(3);
        assertThat(exam.getTitle()).hasSize(50);            // 超长截断
        assertThat(exam.getDescription()).hasSize(200);
        assertThat(result.getConfidence()).isEqualTo(1.0);  // 越界钳制
        assertThat(result.getNote()).contains("已忽略 1 条");
    }

    @Test
    void extractTasksWithNothingToExtractReturnsZeroConfidenceAndNote() {
        when(provider.chatJson(any())).thenReturn("""
                {"tasks":[],"confidence":0}""");

        TaskExtractResult result = ai.extractTasks(textRequest("今天天气不错，我去打球了。"), OWNER);

        assertThat(result.getTasks()).isEmpty();
        assertThat(result.getConfidence()).isZero();
        assertThat(result.getNote()).contains("没有从材料中识别出需要完成的任务");
    }

    @Test
    void extractTasksDegradesGracefullyWhenModelRepliesPlainText() {
        when(provider.chatJson(any())).thenReturn("抱歉，我不理解这段内容。");

        TaskExtractResult result = ai.extractTasks(textRequest("随便一段话"), OWNER);

        assertThat(result.getTasks()).isEmpty();
        assertThat(result.getConfidence()).isZero();
        assertThat(result.getNote()).contains("没有从材料中识别出需要完成的任务");
    }

    @Test
    void extractTasksRejectsMissingOrDuplicateInputs() {
        assertThatThrownBy(() -> ai.extractTasks(new TaskExtractRequest(), OWNER))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(400))
                .hasMessageContaining("二选一");

        TaskExtractRequest both = new TaskExtractRequest();
        both.setText("材料文本");
        both.setImageDataUrl(PNG_DATA_URL);
        assertThatThrownBy(() -> ai.extractTasks(both, OWNER))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("二选一");

        verify(provider, never()).chatJson(any());
    }

    @Test
    void extractTasksRejectsInvalidImageBeforeCallingModel() {
        assertThatThrownBy(() -> ai.extractTasks(imageRequest("data:image/png;base64,not-base64!!"), OWNER))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(400));
        verify(provider, never()).chatJson(any());
    }

    @Test
    void extractTasksRequiresConfiguredProvider() {
        when(provider.isConfigured()).thenReturn(false);

        assertThatThrownBy(() -> ai.extractTasks(textRequest("材料"), OWNER))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(503));
    }

    @Test
    void createBatchPersistsDraftsOwnedByCaller() {
        List<TaskDraft> drafts = List.of(
                draft("提交高等数学第三次作业", Task.TYPE_COURSE_WORK,
                        LocalDateTime.of(2026, 10, 15, 23, 59), 1, "提交到学习通"),
                draft("整理竞赛报名材料", Task.TYPE_COMPETITION, null, 2, null));

        List<Task> created = taskService.createBatch(OWNER, drafts, Task.SOURCE_AI_PARSE);

        assertThat(created).hasSize(2);
        assertThat(created).allSatisfy(task -> {
            assertThat(task.getApiKey()).isEqualTo(OWNER);
            assertThat(task.getStatus()).isEqualTo(Task.STATUS_PENDING);
            assertThat(task.getSource()).isEqualTo(Task.SOURCE_AI_PARSE);
            assertThat(task.getCreatedAt()).isNotNull();
            assertThat(task.getUpdatedAt()).isNotNull();
        });
        assertThat(created.get(1).getDeadline()).isNull(); // 无截止时间如实落库

        List<Task> stored = taskMapper.selectList(new LambdaQueryWrapper<Task>().eq(Task::getApiKey, OWNER));
        assertThat(stored).hasSize(2);
        assertThat(stored).extracting(Task::getTitle)
                .containsExactlyInAnyOrder("提交高等数学第三次作业", "整理竞赛报名材料");
        assertThat(taskMapper.selectCount(new LambdaQueryWrapper<Task>().eq(Task::getApiKey, OTHER))).isZero();
    }

    @Test
    void createBatchRejectsWholeBatchWhenOneDraftInvalid() {
        List<TaskDraft> drafts = new ArrayList<>();
        drafts.add(draft("有效任务", Task.TYPE_OTHER, null, 2, null));
        drafts.add(draft("   ", Task.TYPE_OTHER, null, 2, null)); // 空标题

        assertThatThrownBy(() -> taskService.createBatch(OWNER, drafts, Task.SOURCE_AI_PARSE))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("标题");

        assertThat(taskMapper.selectCount(null)).isZero(); // 整体拒绝，不落半截
    }

    // ==================== 辅助 ====================

    private TaskExtractRequest textRequest(String text) {
        TaskExtractRequest request = new TaskExtractRequest();
        request.setText(text);
        return request;
    }

    private TaskExtractRequest imageRequest(String imageDataUrl) {
        TaskExtractRequest request = new TaskExtractRequest();
        request.setImageDataUrl(imageDataUrl);
        return request;
    }

    private TaskDraft draft(String title, String type, LocalDateTime deadline, int priority, String description) {
        TaskDraft draft = new TaskDraft();
        draft.setTitle(title);
        draft.setType(type);
        draft.setDeadline(deadline);
        draft.setPriority(priority);
        draft.setDescription(description);
        return draft;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private List<LlmClient.Message> captureSingleCall() {
        ArgumentCaptor<List<LlmClient.Message>> prompt =
                (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(provider).chatJson(prompt.capture());
        return prompt.getValue();
    }
}
