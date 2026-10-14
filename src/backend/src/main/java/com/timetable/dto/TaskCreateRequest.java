package com.timetable.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 批量创建任务请求（AI Campus Agent V1.0）。
 *
 * 抽取草稿确认与手动创建共用：source 由服务端按调用方标注（AI_PARSE / MANUAL）。
 */
public class TaskCreateRequest {

    @NotEmpty(message = "任务列表不能为空")
    @Size(max = 20, message = "一次最多创建 20 个任务")
    @Valid
    private List<TaskDraft> tasks;

    public List<TaskDraft> getTasks() { return tasks; }
    public void setTasks(List<TaskDraft> tasks) { this.tasks = tasks; }
}
