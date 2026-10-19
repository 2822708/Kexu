package com.timetable.service.impl;

import com.timetable.entity.Course;
import com.timetable.entity.Memory;
import com.timetable.entity.PeriodConfig;
import com.timetable.entity.Schedule;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.service.LlmClient;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 聊天 system prompt 的「稳定前缀」契约（成本治理 6.1 #4 Prompt Caching）。
 *
 * <p>上游的前缀缓存是从第一个 token 起<b>逐字节</b>比对，只要有一处不同就整段未命中，
 * 而且不会报错——统计里只是永远 0 命中。这种失效没有任何运行时信号，
 * 唯一的防线就是这里：拿两个「只有动态数据不同」的上下文，断言前缀逐字节相等。
 *
 * <p>反过来说，这个测试一旦失败，意味着<b>缓存已经悄悄失效</b>，
 * 而不是「格式化变了」。改动 {@code buildChatSystemPrompt} 的静态段时必须意识到这一点。
 */
class AiPromptCachingTest {

    private static final String PERSONA = "你是学长，语气平实，不说教。";

    @Test
    void stablePrefixIsIdenticalAcrossDifferentDates() {
        LocalDate monday = LocalDate.of(2026, 3, 2);
        ChatFixture a = fixture(monday);
        ChatFixture b = fixture(monday.plusDays(1));

        String prefixA = AiPromptBuilder.buildChatSystemPrompt(a.schedule, a.courses, a.exams,
                a.todos, a.recurring, a.periods, a.today, PERSONA, a.profile, a.tasks, a.memories)
                .stablePrefix();
        String prefixB = AiPromptBuilder.buildChatSystemPrompt(b.schedule, b.courses, b.exams,
                b.todos, b.recurring, b.periods, b.today, PERSONA, b.profile, b.tasks, b.memories)
                .stablePrefix();

        assertThat(prefixA)
                .as("换了日期前缀就变了，说明「当前时间上下文」被混进了稳定段，缓存永远不会命中")
                .isEqualTo(prefixB);
    }

    @Test
    void stablePrefixIsIdenticalWhenAllContextDataChanges() {
        ChatFixture a = fixture(LocalDate.of(2026, 3, 2));
        ChatFixture b = fixture(LocalDate.of(2026, 3, 2));

        // 把动态数据全换掉：课程、任务、记忆、档案都不一样
        b.courses = List.of(course(99L, "另一门课", 5, 3, 4));
        b.tasks = List.of(task(88L, "另一件事"));
        b.memories = List.of(memory(77L, "另一个偏好"));
        b.profile.setMajor("另一个专业");

        String prefixA = AiPromptBuilder.buildChatSystemPrompt(a.schedule, a.courses, a.exams,
                a.todos, a.recurring, a.periods, a.today, PERSONA, a.profile, a.tasks, a.memories)
                .stablePrefix();
        String prefixB = AiPromptBuilder.buildChatSystemPrompt(b.schedule, b.courses, b.exams,
                b.todos, b.recurring, b.periods, b.today, PERSONA, b.profile, b.tasks, b.memories)
                .stablePrefix();

        assertThat(prefixA)
                .as("课程/任务/记忆/档案都变了前缀却不等，说明有动态数据漏进了稳定段")
                .isEqualTo(prefixB);
    }

    @Test
    void personaChangeDoesBreakPrefix() {
        ChatFixture a = fixture(LocalDate.of(2026, 3, 2));

        String withPersona = AiPromptBuilder.buildChatSystemPrompt(a.schedule, a.courses, a.exams,
                a.todos, a.recurring, a.periods, a.today, PERSONA, a.profile, a.tasks, a.memories)
                .stablePrefix();
        String withoutPersona = AiPromptBuilder.buildChatSystemPrompt(a.schedule, a.courses, a.exams,
                a.todos, a.recurring, a.periods, a.today, "换一种人格", a.profile, a.tasks, a.memories)
                .stablePrefix();

        assertThat(withPersona)
                .as("人格模板是前缀的一部分，换模板理应换缓存，这里相等反而说明人格没进 prompt")
                .isNotEqualTo(withoutPersona);
    }

    @Test
    void dynamicContextCarriesDateButStablePrefixDoesNot() {
        ChatFixture a = fixture(LocalDate.of(2026, 3, 2));
        AiPromptBuilder.ChatPrompt prompt = AiPromptBuilder.buildChatSystemPrompt(a.schedule,
                a.courses, a.exams, a.todos, a.recurring, a.periods, a.today, PERSONA,
                a.profile, a.tasks, a.memories);

        assertThat(prompt.stablePrefix())
                .as("日期绝不能出现在稳定前缀里，否则每过一天缓存全废")
                .doesNotContain("2026-03-02")
                .doesNotContain("今天是");
        assertThat(prompt.dynamicContext())
                .as("日期必须在动态段里，否则模型不知道今天几号")
                .contains("2026-03-02")
                .contains("今天是");
    }

    @Test
    void chatSystemMessagesKeepStablePrefixFirst() {
        ChatFixture a = fixture(LocalDate.of(2026, 3, 2));
        AiPromptBuilder.ChatPrompt prompt = AiPromptBuilder.buildChatSystemPrompt(a.schedule,
                a.courses, a.exams, a.todos, a.recurring, a.periods, a.today, PERSONA,
                a.profile, a.tasks, a.memories);

        List<LlmClient.Message> messages = AiPromptBuilder.chatSystemMessages(prompt);

        assertThat(messages).hasSize(2);
        assertThat(messages.get(0).getRole()).isEqualTo("system");
        assertThat(messages.get(1).getRole()).isEqualTo("system");
        // 顺序写反等于两段全废：动态段在前，前缀从日期那行就断了
        assertThat(messages.get(0).getContent())
                .as("稳定前缀必须是第一条消息，顺序颠倒会让缓存完全失效")
                .isEqualTo(prompt.stablePrefix());
        assertThat(messages.get(1).getContent()).isEqualTo(prompt.dynamicContext());
    }

    @Test
    void concatenationStillEqualsSinglePrompt() {
        // 拆两条消息不能改变模型实际看到的内容：中间只差一个换行分隔。
        ChatFixture a = fixture(LocalDate.of(2026, 3, 2));
        AiPromptBuilder.ChatPrompt prompt = AiPromptBuilder.buildChatSystemPrompt(a.schedule,
                a.courses, a.exams, a.todos, a.recurring, a.periods, a.today, PERSONA,
                a.profile, a.tasks, a.memories);

        assertThat(prompt.prompt()).isEqualTo(prompt.stablePrefix() + prompt.dynamicContext());
    }

    // --- fixtures ---------------------------------------------------------

    private static final class ChatFixture {
        Schedule schedule;
        List<Course> courses = new ArrayList<>();
        List<com.timetable.entity.Exam> exams = new ArrayList<>();
        List<com.timetable.entity.Todo> todos = new ArrayList<>();
        List<com.timetable.entity.RecurringTodo> recurring = new ArrayList<>();
        List<PeriodConfig> periods = new ArrayList<>();
        StudentProfile profile = new StudentProfile();
        List<Task> tasks = new ArrayList<>();
        List<Memory> memories = new ArrayList<>();
        LocalDate today;
    }

    private ChatFixture fixture(LocalDate today) {
        ChatFixture f = new ChatFixture();
        f.today = today;

        f.schedule = new Schedule();
        f.schedule.setName("2026 春季学期");
        f.schedule.setPeriodStartDate(today.minusWeeks(2));
        f.schedule.setPeriodEndDate(today.plusWeeks(18));

        PeriodConfig period = new PeriodConfig();
        period.setPeriodNumber(1);
        period.setStartTime(LocalTime.of(8, 0));
        period.setEndTime(LocalTime.of(8, 45));
        f.periods = List.of(period);

        f.courses = List.of(course(1L, "高等数学", 1, 1, 2));
        f.tasks = List.of(task(10L, "写实验报告"));
        f.memories = List.of(memory(20L, "习惯早睡"));

        f.profile.setName("同学");
        f.profile.setMajor("计算机");
        f.profile.setInterest(List.of("算法"));
        f.profile.setSkills(List.of("Java"));
        return f;
    }

    private static Course course(Long id, String name, int dayOfWeek, int start, int end) {
        Course c = new Course();
        c.setId(id);
        c.setName(name);
        c.setDayOfWeek(dayOfWeek);
        c.setStartPeriod(start);
        c.setEndPeriod(end);
        c.setWeeks(List.of(1, 2, 3, 4));
        return c;
    }

    private static Task task(Long id, String title) {
        Task t = new Task();
        t.setId(id);
        t.setTitle(title);
        t.setType(Task.TYPE_COURSE_WORK);
        t.setPriority(2);
        t.setStatus(Task.STATUS_PENDING);
        return t;
    }

    private static Memory memory(Long id, String content) {
        Memory m = new Memory();
        m.setId(id);
        m.setContent(content);
        m.setType(Memory.TYPE_HABIT);
        m.setImportance(3);
        return m;
    }
}
