package com.timetable.dto;

import java.util.List;

/**
 * 查询计划结果（信息处理页 · AI 主动查询中心）。
 *
 * <p>结构来自 {@code prompts/query-plan.md} 约定的 JSON：目标、查询渠道、盯办点、
 * 阶段规划、模型备注。AI 失败时降级为空计划 + note，不阻断页面。
 */
public class QueryPlanResult {

    /** 一句话目标，如「把电赛报名到参赛的关键节点排进日程」 */
    private String goal;
    /** 建议查询的渠道名称（官方站点/公众号/学院通知等，仅名称与检索建议） */
    private List<String> channels;
    /** 盯办点：查的时候要重点核实什么 */
    private List<String> watchouts;
    /** 阶段规划：名称 + 说明 + 建议提前天数（相对锚点日推算） */
    private List<Phase> phases;
    /** 模型备注 / 降级原因 */
    private String note;

    public String getGoal() { return goal; }
    public void setGoal(String goal) { this.goal = goal; }

    public List<String> getChannels() { return channels; }
    public void setChannels(List<String> channels) { this.channels = channels; }

    public List<String> getWatchouts() { return watchouts; }
    public void setWatchouts(List<String> watchouts) { this.watchouts = watchouts; }

    public List<Phase> getPhases() { return phases; }
    public void setPhases(List<Phase> phases) { this.phases = phases; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }

    /** 阶段：name 阶段名 / hint 要做什么 / leadDays 建议提前天数（0 表示锚点当天） */
    public static class Phase {
        private String name;
        private String hint;
        private Integer leadDays;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getHint() { return hint; }
        public void setHint(String hint) { this.hint = hint; }

        public Integer getLeadDays() { return leadDays; }
        public void setLeadDays(Integer leadDays) { this.leadDays = leadDays; }
    }
}
