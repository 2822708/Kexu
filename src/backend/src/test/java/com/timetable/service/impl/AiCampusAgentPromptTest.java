package com.timetable.service.impl;

import com.timetable.entity.AiMessage;
import com.timetable.entity.Memory;
import com.timetable.entity.StudentProfile;
import org.junit.jupiter.api.Test;

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

        PromptTemplateRegistry.PromptTemplate refine = registry.get("memory-extract");
        assertThat(refine).isNotNull();
        assertThat(refine.version()).isEqualTo(1);
        assertThat(refine.body()).contains("memories");
        assertThat(refine.body()).contains("profile");
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
        assertThat(window).contains("- [GOAL·5] 准备 12 月 CET-6 考试");
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
}
