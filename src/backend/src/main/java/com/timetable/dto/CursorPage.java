package com.timetable.dto;

import java.util.List;

/** Bounded cursor page. A null nextCursor means that no older entries remain. */
public class CursorPage<T> {
    private final List<T> items;
    private final String nextCursor;

    public CursorPage(List<T> items, String nextCursor) {
        this.items = List.copyOf(items);
        this.nextCursor = nextCursor;
    }

    public List<T> getItems() { return items; }
    public String getNextCursor() { return nextCursor; }
    public boolean isHasMore() { return nextCursor != null; }
}
