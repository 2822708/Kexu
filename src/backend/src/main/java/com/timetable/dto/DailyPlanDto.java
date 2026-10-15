package com.timetable.dto;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * AI 每日计划（AI Campus Agent V1.0 Step 6）。
 *
 * 时间线由课程块 / 任务块 / 休息块 / 建议块组成：课程块必须与课表一致（服务端校验），
 * 任务块只引用未完成任务，全天至少一个休息块，summary 为学长式总评（≤50 字）。
 */
public class DailyPlanDto {

    private LocalDate date;
    private List<DailyPlanItem> items = new ArrayList<>();
    private String summary;
    /** true 表示来自缓存（同一天已生成过），false 表示本次新生成 */
    private boolean cached;
    /**
     * true 表示计划生成之后，课表/任务等输入数据又变过（计划可能已过时）。
     * 只做提示，不阻止展示——重新生成由用户决定，避免偷偷烧 token。
     */
    private boolean stale;

    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }

    public List<DailyPlanItem> getItems() {
        return items;
    }
    public void setItems(List<DailyPlanItem> items) {
        this.items = items == null ? new ArrayList<>() : items;
    }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public boolean isCached() { return cached; }
    public void setCached(boolean cached) { this.cached = cached; }

    public boolean isStale() { return stale; }
    public void setStale(boolean stale) { this.stale = stale; }

    /** 时间线中的一个块。 */
    public static class DailyPlanItem {
        /** 块类型：COURSE / TASK / BREAK / SUGGESTION */
        private String type;
        private String title;
        /** HH:mm */
        private String start;
        /** HH:mm */
        private String end;
        /** COURSE→课程 id，TASK→任务 id，BREAK/SUGGESTION→null */
        private Long refId;
        private String note;

        public String getType() { return type; }
        public void setType(String type) { this.type = type; }

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }

        public String getStart() { return start; }
        public void setStart(String start) { this.start = start; }

        public String getEnd() { return end; }
        public void setEnd(String end) { this.end = end; }

        public Long getRefId() { return refId; }
        public void setRefId(Long refId) { this.refId = refId; }

        public String getNote() { return note; }
        public void setNote(String note) { this.note = note; }
    }
}
