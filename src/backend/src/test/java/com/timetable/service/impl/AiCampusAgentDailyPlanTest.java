package com.timetable.service.impl;

import com.timetable.config.LlmBudgetProperties;
import com.timetable.config.LlmPricingProperties;
import com.timetable.service.AiEventRecorder;
import com.timetable.service.LlmBudgetService;
import com.timetable.config.LlmProperties;
import com.timetable.config.ValidatedFlywayMigration;
import com.timetable.dto.DailyPlanDto;
import com.timetable.dto.ScheduleRequest;
import com.timetable.entity.Schedule;
import com.timetable.entity.Task;
import com.timetable.exception.BusinessException;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.DailyPlanService;
import com.timetable.service.LlmClient;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.RequestValidationService;
import com.timetable.service.ScheduleService;
import com.timetable.service.TaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.mockito.ArgumentCaptor;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 每日计划（AI Campus Agent V1.0 Step 6）。
 *
 * 与既有 Campus Agent 测试同一模式：真实事务、真实 Mapper、真实 Flyway 迁移的 H2，
 * 只 mock 外部 LLM。重点固化「课程块与课表一致 / 任务块只排未完成任务 / 必须含休息 /
 * 二次生成命中缓存」四条验收标准。
 */
@ActiveProfiles("campus-agent-plan")
@SpringBootTest(classes = AiCampusAgentDailyPlanTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:campus_agent_plan;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.flyway.locations=classpath:db/migration/h2", "spring.sql.init.mode=never",
        "app.admin-api-keys=configured-admin", "logging.level.com.timetable=WARN"
})
class AiCampusAgentDailyPlanTest {

    private static final String OWNER = "plan-owner";
    /** 2026-09-28 是周一：课程 dayOfWeek=1 命中，教学周 4 命中。 */
    private static final LocalDate MONDAY = LocalDate.of(2026, 9, 28);

    @Configuration(proxyBeanMethods = false)
    @Profile("campus-agent-plan")
    @EnableAutoConfiguration
    @MapperScan("com.timetable.mapper")
    @Import({ValidatedFlywayMigration.class, AdminAuthorizationService.class,
            RequestValidationService.class, ScheduleServiceImpl.class, CourseServiceImpl.class, ExamServiceImpl.class,
            TodoServiceImpl.class, RecurringTodoServiceImpl.class, RecurringScriptEvaluator.class,
            PeriodConfigServiceImpl.class, TaskServiceImpl.class, StudentProfileServiceImpl.class,
            MemoryServiceImpl.class, DailyPlanServiceImpl.class, AiEventRecorder.class,
            LlmClientRegistry.class, LlmProperties.class, LlmBudgetService.class, LlmBudgetProperties.class, LlmPricingProperties.class, PromptTemplateRegistry.class})
    static class TestApplication {
        @Bean
        Clock clock() {
            // 用系统时钟而不是固定时刻：stale 判定比较的是「计划 created_at」与各输入表 ON UPDATE
            // 的时间戳，两者必须与 H2 的 NOW() 同源（默认时区），固定时刻会让判定恒为 true。
            return Clock.systemDefaultZone();
        }
    }

    @Autowired JdbcTemplate sql;
    @Autowired ScheduleService schedules;
    @Autowired TaskService taskService;
    @Autowired DailyPlanService plans;
    @MockBean LlmClient provider;

    @BeforeEach
    void resetDisposableDatabase() {
        for (String table : List.of("daily_plan", "task", "exam", "course", "schedule",
                "api_key", "student_profile")) {
            sql.update("DELETE FROM " + table);
        }
        sql.update("INSERT INTO api_key(api_key,label,account_role) VALUES (?,?,'USER')", OWNER, "Plan owner");
        when(provider.isConfigured()).thenReturn(true);
    }

    @Test
    void generateBuildsTimelineFromRealCoursesAndTasksThenCaches() throws Exception {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2); // 周一 1-2 节 → 08:00-09:35
        Task task = taskService.create(OWNER, draft("提交高数第三次作业", Task.TYPE_COURSE_WORK), Task.SOURCE_MANUAL);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":"带教材"},
                  {"type":"TASK","start":"10:00","end":"11:00","title":"推进高数作业","ref_id":%d,"note":"先做第一题"},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""},
                  {"type":"SUGGESTION","start":"20:00","end":"20:30","title":"复习笔记","ref_id":null,"note":""}
                """.formatted(courseId, task.getId()), "今天最关键的是把高数作业推进一题"));

        DailyPlanDto plan = plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(plan.isCached()).isFalse();
        assertThat(plan.getDate()).isEqualTo(MONDAY);
        assertThat(plan.getSummary()).isEqualTo("今天最关键的是把高数作业推进一题");
        assertThat(plan.getItems()).hasSize(4);
        // 块按开始时刻升序；课程块时刻与课表完全一致（第1-2节 = 08:00-09:35）
        assertThat(plan.getItems()).extracting(DailyPlanDto.DailyPlanItem::getType)
                .containsExactly("COURSE", "TASK", "BREAK", "SUGGESTION");
        assertThat(plan.getItems().get(0).getStart()).isEqualTo("08:00");
        assertThat(plan.getItems().get(0).getEnd()).isEqualTo("09:35");
        assertThat(plan.getItems().get(0).getRefId()).isEqualTo(courseId);
        assertThat(plan.getItems().get(1).getRefId()).isEqualTo(task.getId());

        // 落库：一天一条
        assertThat(sql.queryForObject("SELECT COUNT(*) FROM daily_plan WHERE api_key=? AND plan_date=?",
                Integer.class, OWNER, MONDAY.toString())).isEqualTo(1);

        // 输入只给真实数据：课程 id 与换算后的真实起止时刻都出现在模型输入里
        ArgumentCaptor<List<LlmClient.Message>> payload = ArgumentCaptor.forClass(List.class);
        verify(provider).chatJson(any(), payload.capture());
        String user = payload.getValue().get(1).getContent();
        assertThat(user).contains("id=" + courseId).contains("08:00-09:35");
        assertThat(user).contains("id=" + task.getId()).contains("提交高数第三次作业");
        assertThat(payload.getValue().get(0).getContent()).contains("学长").contains("BREAK");
    }

    @Test
    void secondGenerateHitsCacheWithoutCallingModel() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "线性代数", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"线性代数","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "先上课，午休后再推进任务"));

        DailyPlanDto first = plans.generate(OWNER, schedule.getId(), MONDAY);
        DailyPlanDto second = plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(first.isCached()).isFalse();
        assertThat(second.isCached()).isTrue();
        assertThat(second.getSummary()).isEqualTo(first.getSummary());
        assertThat(second.getItems()).hasSize(2);
        verify(provider, times(1)).chatJson(any(), any());
    }

    @Test
    void getReturnsCachedPlanOnly() {
        assertThat(plans.get(OWNER, MONDAY)).isNull();
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "大学英语", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"大学英语","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "今天只有一节课"));

        plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(plans.get(OWNER, MONDAY)).isNotNull();
        // 另一天没有计划
        assertThat(plans.get(OWNER, MONDAY.plusDays(1))).isNull();
    }

    @Test
    void cachedPlanIsFlaggedStaleAfterInputDataChanges() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "大学英语", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"大学英语","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "今天只有一节课"));

        DailyPlanDto fresh = plans.generate(OWNER, schedule.getId(), MONDAY);
        assertThat(fresh.isStale()).isFalse();
        // 刚生成完立即读，不应误报过时
        assertThat(plans.get(OWNER, MONDAY).isStale()).isFalse();

        // 用户新增一个任务 → 计划的输入已经变了
        taskService.create(OWNER, draft("临时插入的作业", Task.TYPE_COURSE_WORK), Task.SOURCE_MANUAL);
        assertThat(plans.get(OWNER, MONDAY).isStale())
                .as("数据变了应提示计划可能过时，但仍返回旧计划（不偷偷烧 token）")
                .isTrue();
        // 用户主动重新生成：stale 的缓存被覆盖重算，而不是继续返回旧计划
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"大学英语","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "重新排过"));
        DailyPlanDto regenerated = plans.generate(OWNER, schedule.getId(), MONDAY);
        assertThat(regenerated.isCached()).isFalse();
        assertThat(regenerated.getSummary()).isEqualTo("重新排过");
        assertThat(regenerated.isStale()).isFalse();
        // 覆盖而不是叠加：同一天仍然只有一条计划
        assertThat(rowCount()).isEqualTo(1);
        verify(provider, times(2)).chatJson(any(), any());
    }

    @Test
    void planRejectsCourseBlockThatDisagreesWithTimetable() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"09:00","end":"10:00","title":"高等数学","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId), "时间被改了"));

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("课程时间与课表不一致");
        assertThat(rowCount()).isZero();
    }

    @Test
    void planRejectsWhenTodaysCourseIsOmitted() {
        Schedule schedule = schedule();
        seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"SUGGESTION","start":"10:00","end":"11:00","title":"自习","ref_id":null,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """, "漏了课"));

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("遗漏了今天的课程");
        assertThat(rowCount()).isZero();
    }

    @Test
    void planRejectsTaskThatIsNotOpen() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        Task done = taskService.create(OWNER, draft("已完成的作业", Task.TYPE_OTHER), Task.SOURCE_MANUAL);
        taskService.updateStatus(done.getId(), "DONE", OWNER);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""},
                  {"type":"TASK","start":"10:00","end":"11:00","title":"重做已完成的","ref_id":%d,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """.formatted(courseId, done.getId()), "排了已完成的任务"));

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("不存在或已完成的任务");
        assertThat(rowCount()).isZero();
    }

    @Test
    void planRejectsTimelineWithoutBreak() {
        Schedule schedule = schedule();
        Long courseId = seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"COURSE","start":"08:00","end":"09:35","title":"高等数学","ref_id":%d,"note":""},
                  {"type":"SUGGESTION","start":"10:00","end":"11:00","title":"写实验报告","ref_id":null,"note":""}
                """.formatted(courseId), "塞满了"));

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("没有安排休息");
        assertThat(rowCount()).isZero();
    }

    @Test
    void planRejectsUnparsableModelOutput() {
        Schedule schedule = schedule();
        seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.chatJson(any(), any())).thenReturn("抱歉，我今天不太会排计划。");

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("未返回可解析的计划");
        assertThat(rowCount()).isZero();
    }

    @Test
    void planRequiresConfiguredProvider() {
        Schedule schedule = schedule();
        seedCourse(schedule.getId(), "高等数学", 1, 1, 2);
        when(provider.isConfigured()).thenReturn(false);

        assertThatThrownBy(() -> plans.generate(OWNER, schedule.getId(), MONDAY))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("AI 服务未配置");
        assertThat(rowCount()).isZero();
    }

    @Test
    void emptyDayStillProducesSuggestionAndBreak() {
        Schedule schedule = schedule(); // 周一没有课
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"SUGGESTION","start":"09:00","end":"10:00","title":"复习线代","ref_id":null,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """, "没课的一天也别把自己逼太紧"));

        DailyPlanDto plan = plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(plan.getItems()).extracting(DailyPlanDto.DailyPlanItem::getType)
                .containsExactly("SUGGESTION", "BREAK"); // 按开始时刻升序
        assertThat(plan.getSummary()).isEqualTo("没课的一天也别把自己逼太紧");
    }

    @Test
    void planTruncatesOverlongSummary() {
        Schedule schedule = schedule();
        when(provider.chatJson(any(), any())).thenReturn(planJson("""
                  {"type":"SUGGESTION","start":"09:00","end":"10:00","title":"复习","ref_id":null,"note":""},
                  {"type":"BREAK","start":"12:00","end":"13:00","title":"午休","ref_id":null,"note":""}
                """, "一".repeat(80)));

        DailyPlanDto plan = plans.generate(OWNER, schedule.getId(), MONDAY);

        assertThat(plan.getSummary()).hasSize(50);
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
        request.setName("Plan schedule");
        request.setPeriodStartDate(LocalDate.of(2026, 9, 7));
        request.setPeriodEndDate(LocalDate.of(2027, 1, 31));
        return schedules.create(request, OWNER);
    }

    private Long seedCourse(Long scheduleId, String name, int dayOfWeek, int start, int end) {
        sql.update("INSERT INTO course(schedule_id,name,day_of_week,start_period,end_period,weeks) "
                + "VALUES (?,?,?,?,?,?)", scheduleId, name, dayOfWeek, start, end, "[1,2,3,4]");
        return sql.queryForObject("SELECT MAX(id) FROM course WHERE schedule_id=?", Long.class, scheduleId);
    }

    private com.timetable.dto.TaskDraft draft(String title, String type) {
        com.timetable.dto.TaskDraft draft = new com.timetable.dto.TaskDraft();
        draft.setTitle(title);
        draft.setType(type);
        draft.setPriority(2);
        draft.setDescription("");
        draft.setDeadline(java.time.LocalDateTime.of(2026, 10, 15, 23, 59));
        return draft;
    }
}
