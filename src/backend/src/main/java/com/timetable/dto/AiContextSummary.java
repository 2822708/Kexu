package com.timetable.dto;

/**
 * AI 聊天的上下文注入摘要（AI Campus Agent V1.0 Step 3）。
 *
 * 与注入 system prompt 的五段式上下文（档案 / 课表 / 任务 / 记忆）逐项对应，
 * 计数为实际注入的条数（截断后），供前端在输入框上方展示上下文 chips，
 * 让用户知道「学长这轮看到了什么」。
 */
public class AiContextSummary {

    /** 档案是否已有实质内容（任一字段非空）。 */
    private boolean profilePresent;
    /** 注入的课程条数（当前课表全量，受上限约束）。 */
    private int courseCount;
    /** 注入的任务条数（未完成、14 天内/已逾期/无截止，截断后）。 */
    private int taskCount;
    /** 注入的长期记忆条数（ACTIVE 按重要度，截断后）。 */
    private int memoryCount;
    /** 任务是否因超出 15 条上限被截断（还有更多未展示）。 */
    private boolean tasksTruncated;
    /** 记忆是否因超出 20 条上限被截断。 */
    private boolean memoriesTruncated;

    public boolean isProfilePresent() { return profilePresent; }
    public void setProfilePresent(boolean profilePresent) { this.profilePresent = profilePresent; }

    public int getCourseCount() { return courseCount; }
    public void setCourseCount(int courseCount) { this.courseCount = courseCount; }

    public int getTaskCount() { return taskCount; }
    public void setTaskCount(int taskCount) { this.taskCount = taskCount; }

    public int getMemoryCount() { return memoryCount; }
    public void setMemoryCount(int memoryCount) { this.memoryCount = memoryCount; }

    public boolean isTasksTruncated() { return tasksTruncated; }
    public void setTasksTruncated(boolean tasksTruncated) { this.tasksTruncated = tasksTruncated; }

    public boolean isMemoriesTruncated() { return memoriesTruncated; }
    public void setMemoriesTruncated(boolean memoriesTruncated) { this.memoriesTruncated = memoriesTruncated; }
}
