package com.timetable.service.impl;

import com.timetable.dto.AiContextSummary;
import com.timetable.entity.AiMessage;
import com.timetable.entity.Memory;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** Prompt 模板注册表与记忆提炼窗口的纯单元测试（不启动 Spring）。 */
class AiCampusAgentPromptTest {

    @Test
    void frontMatterVersionIsParsedAndStrippedFromBody() {
        PromptTemplateRegistry.PromptTemplate template =
                PromptTemplateRegistry.parse("persona", "---\nversion: 3\n---\n正文内容\n第二行");

        assertThat(template.name()).isEqualTo("persona");
        assertThat(template.version()).isEqualTo(3);
        assertThat(template.body()).isEqualTo("正文内容\n第二行");
    }

    @Test
    void templateWithoutFrontMatterKeepsBodyAndVersionZero() {
        PromptTemplateRegistry.PromptTemplate template =
                PromptTemplateRegistry.parse("plain", "没有版本声明的正文");

        assertThat(template.version()).isZero();
        assertThat(template.body()).isEqualTo("没有版本声明的正文");
    }

    @Test
    void bundledTemplatesLoadFromClasspath() {
        PromptTemplateRegistry registry = new PromptTemplateRegistry();

        PromptTemplateRegistry.PromptTemplate persona = registry.get("persona");
        assertThat(persona).isNotNull();
        assertThat(persona.version()).isEqualTo(1);
        assertThat(persona.body()).contains("学长");

        // Step 7：提炼模板升到 v2，新增「同一事实走 UPDATE + target_id」规则
        PromptTemplateRegistry.PromptTemplate refine = registry.get("memory-extract");
        assertThat(refine).isNotNull();
        assertThat(refine.version()).isEqualTo(2);
        assertThat(refine.body()).contains("memories");
        assertThat(refine.body()).contains("profile");
        assertThat(refine.body()).contains("target_id");
        assertThat(refine.body()).contains("UPDATE");
    }

    @Test
    void missingTemplateReturnsNullInsteadOfThrowing() {
        assertThat(new PromptTemplateRegistry().get("does-not-exist")).isNull();
    }

    @Test
    void memoryRefineWindowContainsProfileMemoriesAndDialogue() {
        StudentProfile profile = new StudentProfile();
        profile.setName("小明");
        profile.setGoal("通过六级");
        profile.setInterest(List.of("机器学习"));
        profile.setSkills(List.of("Java"));

        Memory memory = new Memory();
        memory.setId(7L);
        memory.setType(Memory.TYPE_GOAL);
        memory.setContent("准备 12 月 CET-6 考试");
        memory.setImportance(5);

        AiMessage user = new AiMessage();
        user.setRole("user");
        user.setContent("我报了 12 月的六级");
        AiMessage assistant = new AiMessage();
        assistant.setRole("assistant");
        assistant.setContent("加油，一起准备");

        String window = AiPromptBuilder.buildMemoryRefineWindow(profile, List.of(memory), List.of(user, assistant));

        assertThat(window).contains("【学生档案】");
        assertThat(window).contains("姓名=小明");
        assertThat(window).contains("目标=通过六级");
        assertThat(window).contains("兴趣=机器学习");
        assertThat(window).contains("技能=Java");
        assertThat(window).contains("【已有长期记忆】");
        // 带 id：模型修正已有记忆时要回传 target_id，否则服务端无法定位
        assertThat(window).contains("- #7 [GOAL·5] 准备 12 月 CET-6 考试");
        assertThat(window).contains("【对话窗口】");
        assertThat(window).contains("用户：我报了 12 月的六级");
        assertThat(window).contains("学长：加油，一起准备");
    }

    @Test
    void memoryRefineWindowHandlesEmptyProfileAndMemories() {
        String window = AiPromptBuilder.buildMemoryRefineWindow(null, List.of(), List.of());

        assertThat(window).contains("（未填写）");
        assertThat(window).contains("（无）");
        assertThat(window).contains("（空）");
    }

    // ==================== 五段式上下文（Step 3） ====================

    private static AiPromptBuilder.ChatPrompt chatPrompt(StudentProfile profile, List<Task> tasks,
                                                          List<Memory> memories) {
        return AiPromptBuilder.buildChatSystemPrompt(null, List.of(), List.of(), List.of(), List.of(),
                List.of(), LocalDate.of(2026, 9, 27), null, profile, tasks, memories);
    }

    private static Task task(long id, String title) {
        Task task = new Task();
        task.setId(id);
        task.setTitle(title);
        task.setType(Task.TYPE_OTHER);
        task.setPriority(Task.PRIORITY_MEDIUM);
        task.setStatus(Task.STATUS_PENDING);
        task.setDeadline(LocalDateTime.of(2026, 9, 30, 23, 59));
        return task;
    }

    private static Memory memory(long id, String content, int importance) {
        Memory memory = new Memory();
        memory.setId(id);
        memory.setType(Memory.TYPE_HABIT);
        memory.setContent(content);
        memory.setImportance(importance);
        return memory;
    }

    @Test
    void chatPromptShowsPlaceholdersWhenNoProfileTasksOrMemories() {
        AiPromptBuilder.ChatPrompt built = chatPrompt(null, List.of(), List.of());

        assertThat(built.prompt()).contains("### 学生档案");
        assertThat(built.prompt()).contains("（尚未填写。");
        assertThat(built.prompt()).contains("### 当前任务");
        assertThat(built.prompt()).contains("（无）");
        assertThat(built.prompt()).contains("### 长期记忆");
        assertThat(built.prompt()).contains("（暂无）");
        assertThat(built.summary().isProfilePresent()).isFalse();
        assertThat(built.summary().getTaskCount()).isZero();
        assertThat(built.summary().getMemoryCount()).isZero();
    }

    @Test
    void chatPromptTaskSectionCapsAtFifteenWithTruncationNote() {
        List<Task> tasks = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            tasks.add(task(i + 1L, "任务 " + i));
        }

        AiPromptBuilder.ChatPrompt built = chatPrompt(null, tasks, List.of());

        assertThat(built.prompt()).contains("当前仅提供前 15 条，共 20 条");
        assertThat(built.prompt()).contains("id=1 标题=任务 0");
        assertThat(built.prompt()).doesNotContain("标题=任务 19");
        assertThat(built.summary().getTaskCount()).isEqualTo(15);
        assertThat(built.summary().isTasksTruncated()).isTrue();
    }

    @Test
    void chatPromptMemorySectionCapsAtTwentyWithTruncationNote() {
        List<Memory> memories = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            memories.add(memory(i + 1L, "记忆 " + i, 5));
        }

        AiPromptBuilder.ChatPrompt built = chatPrompt(null, List.of(), memories);

        assertThat(built.prompt()).contains("当前仅提供重要度前 20 条，共 25 条");
        assertThat(built.prompt()).contains("- [习惯·重要度5] 记忆 0");
        assertThat(built.prompt()).doesNotContain("记忆 24");
        assertThat(built.summary().getMemoryCount()).isEqualTo(20);
        assertThat(built.summary().isMemoriesTruncated()).isTrue();
    }

    @Test
    void chatPromptProfileSectionListsAllFilledFields() {
        StudentProfile profile = new StudentProfile();
        profile.setName("小明");
        profile.setSchool("清华大学");
        profile.setMajor("计算机科学与技术");
        profile.setGrade("2024 级");
        profile.setGoal("通过六级");
        profile.setLearningStyle("先理解再刷题");
        profile.setInterest(List.of("机器学习", "吉他"));
        profile.setSkills(List.of("Java"));

        AiPromptBuilder.ChatPrompt built = chatPrompt(profile, List.of(), List.of());

        assertThat(built.prompt()).contains("姓名=小明 学校=清华大学 专业=计算机科学与技术 年级=2024 级");
        assertThat(built.prompt()).contains("兴趣=机器学习、吉他");
        assertThat(built.prompt()).contains("技能=Java");
        assertThat(built.summary().isProfilePresent()).isTrue();
    }

    @Test
    void chatPromptProtocolDocumentsTaskActionsAndModuleRules() {
        AiPromptBuilder.ChatPrompt built = chatPrompt(null, List.of(), List.of());

        // Step 5：任务域进入动作协议，与待办域明确区分
        assertThat(built.prompt()).contains("- CREATE_TASK: {\"tasks\":[");
        assertThat(built.prompt()).contains("- UPDATE_TASK: {\"tasks\":[");
        assertThat(built.prompt()).contains("## 任务模块说明（与待办相互独立）");
        assertThat(built.prompt()).contains("deadline 只取明确写出的日期/时间");
        assertThat(built.prompt()).contains("status\":\"PENDING|IN_PROGRESS|DONE|CANCELLED\"");
        // 任务域六类型白名单在协议里可查
        assertThat(built.prompt()).contains("COURSE_WORK|LAB_REPORT|ONLINE_COURSE|EXAM|COMPETITION|OTHER");
    }

    @Test
    void summarizeContextAppliesBudgetsAndProfilePresence() {
        StudentProfile empty = new StudentProfile();
        assertThat(AiPromptBuilder.summarizeContext(empty, 5, 3, 2).isProfilePresent()).isFalse();

        StudentProfile profile = new StudentProfile();
        profile.setGoal("考研");
        AiContextSummary summary = AiPromptBuilder.summarizeContext(profile, 150, 20, 5);

        assertThat(summary.isProfilePresent()).isTrue();
        assertThat(summary.getCourseCount()).isEqualTo(100);
        assertThat(summary.getTaskCount()).isEqualTo(15);
        assertThat(summary.isTasksTruncated()).isTrue();
        assertThat(summary.getMemoryCount()).isEqualTo(5);
        assertThat(summary.isMemoriesTruncated()).isFalse();
    }
}
