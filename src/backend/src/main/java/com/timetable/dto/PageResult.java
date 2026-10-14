package com.timetable.dto;

import java.util.List;

public record PageResult<T>(List<T> items, long total, int page, int pageSize, boolean hasMore) {
    public PageResult(List<T> items, long total, int page, int pageSize) {
        this(items, total, page, pageSize, (long) page * pageSize < total);
    }
}
