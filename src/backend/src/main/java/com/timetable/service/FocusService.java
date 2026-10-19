package com.timetable.service;

import java.time.LocalDate;
import java.util.List;

public interface FocusService {
    List<Long> completedCourseIds(Long scheduleId, LocalDate date, String apiKey);
    void setCourseCompleted(Long scheduleId, Long courseId, LocalDate date, boolean completed, String apiKey);
}
