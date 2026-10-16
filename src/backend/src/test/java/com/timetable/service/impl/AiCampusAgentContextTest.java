package com.timetable.service.impl;

import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.AiContextSummary;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.CourseRequest;
import com.timetable.dto.ScheduleRequest;
import com.timetable.dto.StudentProfilePatch;
import com.timetable.entity.AiConversation;
import com.timetable.entity.Course;
import com.timetable.entity.Memory;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.mapper.TaskMapper;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.AiService;
import com.timetable.service.CourseService;
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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI Campus Agent V1.0 Step 3：五段式上下文注入（档案 / 课表 / 任务 / 记忆）与上下文摘要。
 *
 * 验收对齐：问"今天有什么课 / 最近任务 / 与目标差距"时，注入 system prompt 的数据
 * 必须与库中真实数据一致（含真实 id），超预算段截断并标注。
 */
@ActiveProfiles("campus-agent-context")
@SpringBootTest(classes = AiCampusAgentContextTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_context;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentContextTest {

    private static final String OWNER = "context-owner";

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-context")
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
    @Autowired CourseService courses;
    @Autowired AiService ai;
    @Autowired TaskMapper taskMapper;
    @Autowired MemoryService memoryService;
    @Autowired StudentProfileService studentProfileService;
    @MockBean LlmClient provider;

    /** 固定时钟下的当前时刻（Asia/Shanghai）。 */
    private LocalDateTime now() {
        return LocalDateTime.of(2026, 9, 27, 10, 6);
    }

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("ai_action", "ai_message", "ai_conversation", "todo", "recurring_todo",
                "course", "exam", "schedule", "api_key", "student_profile", "student_memory", "task", "daily_plan")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Context owner");
        when(provider.isConfigured()).thenReturn(true);
        when(provider.chatJson(any(), any())).thenReturn("{\"text\":\"好的\",\"actions\":[]}");
    }

    @Test
    void fiveSegmentContextInjectsRealIdsWithBudgetRules() {
        Schedule schedule = schedule(OWNER, "Ctx");
        AiConversation conversation = conversation(schedule.getId());
        Course course = course(schedule.getId(), "线性代数");

        // 档案：仅姓名也有实质内容
        StudentProfilePatch patch = new StudentProfilePatch();
        patch.setName("小明");
        patch.setMajor("计算机科学与技术");
        patch.setGoal("通过六级");
        studentProfileService.applyPatch(OWNER, patch, StudentProfile.UPDATED_BY_USER);
        memoryService.create(OWNER, Memory.TYPE_GOAL, "准备 12 月 CET-6 考试", 5, Memory.SOURCE_AI, null);

        Task overdue = task("逾期：补交实验报告", now().minusDays(1), Task.STATUS_PENDING);
        Task inWindow = task("三天内：近代史作业", now().plusDays(3), Task.STATUS_PENDING);
        Task outOfWindow = task("三十天后：期末项目", now().plusDays(30), Task.STATUS_PENDING);
        Task done = task("已完成：英语听力", now().plusDays(2), Task.STATUS_DONE);
        Task noDeadline = task("无截止：学吉他", null, Task.STATUS_IN_PROGRESS);

        ai.sendMessage(conversation.getId(), request(schedule.getId(), "我最近有什么任务"), OWNER);

        String system = captureSystemPrompt();
        // 五段式三段新数据都在，且带真实 id
        assertThat(system).contains("### 学生档案").contains("姓名=小明").contains("专业=计算机科学与技术");
        assertThat(system).contains("### 当前任务");
        assertThat(system).contains("id=" + overdue.getId() + " 标题=逾期：补交实验报告");
        assertThat(system).contains("id=" + inWindow.getId() + " 标题=三天内：近代史作业");
        assertThat(system).contains("id=" + noDeadline.getId() + " 标题=无截止：学吉他");
        assertThat(system).contains("### 长期记忆").contains("[目标·重要度5] 准备 12 月 CET-6 考试");
        assertThat(system).contains("id=" + course.getId() + " 名称=线性代数");
        // 窗口外 / 已完成的任务不进上下文
        assertThat(system).doesNotContain(outOfWindow.getTitle());
        assertThat(system).doesNotContain(done.getTitle());
        // 排序：截止升序，无截止排最后
        assertThat(system.indexOf(overdue.getTitle()))
                .isLessThan(system.indexOf(inWindow.getTitle()))
                .isLessThan(system.indexOf(noDeadline.getTitle()));
        // 类型/状态中文标注
        assertThat(system).contains("类型=课程作业").contains("状态=未开始").contains("状态=进行中");
    }

    @Test
    void taskBudgetCapsAtFifteenWithTruncationNote() {
        Schedule schedule = schedule(OWNER, "Budget");
        AiConversation conversation = conversation(schedule.getId());
        for (int i = 0; i < 17; i++) {
            task("批量任务 " + i, now().plusDays(1), Task.STATUS_PENDING);
        }

        ai.sendMessage(conversation.getId(), request(schedule.getId(), "列一下我的任务"), OWNER);

        String system = captureSystemPrompt();
        assertThat(system).contains("当前仅提供前 15 条，共 17 条");
        assertThat(system).contains("批量任务 0");
        assertThat(system).doesNotContain("批量任务 16");
    }

    @Test
    void contextSummaryReflectsSeededData() {
        Schedule schedule = schedule(OWNER, "Summary");
        AiConversation conversation = conversation(schedule.getId());
        course(schedule.getId(), "大学英语");
        StudentProfilePatch patch = new StudentProfilePatch();
        patch.setSchool("清华大学");
        studentProfileService.applyPatch(OWNER, patch, StudentProfile.UPDATED_BY_USER);
        task("写简历", now().plusDays(2), Task.STATUS_PENDING);
        task("做课程项目", now().plusDays(30), Task.STATUS_PENDING); // 窗口外，不计入
        memoryService.create(OWNER, Memory.TYPE_HABIT, "习惯晚饭后散步", 2, Memory.SOURCE_USER, null);

        AiContextSummary summary = ai.contextSummary(conversation.getId(), OWNER);

        assertThat(summary.isProfilePresent()).isTrue();
        assertThat(summary.getCourseCount()).isEqualTo(1);
        assertThat(summary.getTaskCount()).isEqualTo(1);
        assertThat(summary.getMemoryCount()).isEqualTo(1);
        assertThat(summary.isTasksTruncated()).isFalse();
        assertThat(summary.isMemoriesTruncated()).isFalse();
    }

    @Test
    void contextSummaryOnEmptyAccountIsAllZero() {
        Schedule schedule = schedule(OWNER, "Empty");
        AiConversation conversation = conversation(schedule.getId());

        AiContextSummary summary = ai.contextSummary(conversation.getId(), OWNER);

        assertThat(summary.isProfilePresent()).isFalse();
        assertThat(summary.getCourseCount()).isZero();
        assertThat(summary.getTaskCount()).isZero();
        assertThat(summary.getMemoryCount()).isZero();
        assertThat(summary.isTasksTruncated()).isFalse();
        assertThat(summary.isMemoriesTruncated()).isFalse();
    }

    @Test
    void contextSummaryRejectsForeignConversation() {
        Schedule schedule = schedule(OWNER, "Foreign");
        AiConversation conversation = conversation(schedule.getId());
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", "stranger", "Stranger");

        org.junit.jupiter.api.Assertions.assertThrows(com.timetable.exception.BusinessException.class,
                () -> ai.contextSummary(conversation.getId(), "stranger"));
    }

    // ==================== 辅助 ====================

    /** 捕获主聊天调用（第一次 chatJson）的 system prompt。 */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private String captureSystemPrompt() {
        ArgumentCaptor<List<LlmClient.Message>> prompt =
                (ArgumentCaptor) ArgumentCaptor.forClass(List.class);
        verify(provider, atLeastOnce()).chatJson(any(), prompt.capture());
        return prompt.getAllValues().get(0).get(0).getContent();
    }

    private Task task(String title, LocalDateTime deadline, String status) {
        Task task = new Task();
        task.setApiKey(OWNER);
        task.setTitle(title);
        task.setType(Task.TYPE_COURSE_WORK);
        task.setPriority(Task.PRIORITY_MEDIUM);
        task.setStatus(status);
        task.setDeadline(deadline);
        task.setSource(Task.SOURCE_MANUAL);
        taskMapper.insert(task);
        return task;
    }

    private Course course(Long scheduleId, String name) {
        CourseRequest request = new CourseRequest();
        request.setName(name);
        request.setDayOfWeek(1);
        request.setStartPeriod(1);
        request.setEndPeriod(2);
        request.setWeeks(List.of(1, 2, 3));
        return courses.create(scheduleId, request, OWNER);
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
