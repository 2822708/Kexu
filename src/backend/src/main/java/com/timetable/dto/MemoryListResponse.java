package com.timetable.dto;

import com.timetable.entity.Memory;

import java.util.List;

/**
 * 设置页「长期记忆」列表的返回体（AI Campus Agent V1.0 Step 7）。
 *
 * <p>items 只含 ACTIVE 记忆；injected 表示其中真正会进入 AI 上下文的条数
 * （按重要度取前 limit 条），用于提示用户「超出部分不会被引擎看到」。
 */
public class MemoryListResponse {

    private List<Memory> items;
    private int total;
    private int injected;
    private int limit;

    public MemoryListResponse() {
    }

    public MemoryListResponse(List<Memory> items, int injected, int limit) {
        this.items = items;
        this.total = items == null ? 0 : items.size();
        this.injected = injected;
        this.limit = limit;
    }

    public List<Memory> getItems() { return items; }
    public void setItems(List<Memory> items) { this.items = items; }

    public int getTotal() { return total; }
    public void setTotal(int total) { this.total = total; }

    public int getInjected() { return injected; }
    public void setInjected(int injected) { this.injected = injected; }

    public int getLimit() { return limit; }
    public void setLimit(int limit) { this.limit = limit; }
}
