package com.timetable.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 任务抽取结果（AI Campus Agent V1.0 Step 4）。
 *
 * **不落库**：草稿经用户核对/编辑后由 POST /api/tasks 创建（human-in-the-loop）。
 * confidence 低于 0.6 时前端强制人工逐条核对；note 用于提示清洗/降级信息。
 */
public class TaskExtractResult {

    private List<TaskDraft> tasks = new ArrayList<>();
    private double confidence;
    private String note;

    public List<TaskDraft> getTasks() { return tasks; }
    public void setTasks(List<TaskDraft> tasks) { this.tasks = tasks == null ? new ArrayList<>() : tasks; }

    public double getConfidence() { return confidence; }
    public void setConfidence(double confidence) { this.confidence = confidence; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
