package com.timetable.dto;

import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.RecurringTodo;
import com.timetable.entity.Schedule;
import com.timetable.entity.Todo;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

/** Explicit public read models; account keys and internal claim state are never serialized. */
public final class CatalogViews {
    private CatalogViews() {}

    public record ScheduleView(Long id, String name, LocalDate periodStartDate,
                               LocalDate periodEndDate, LocalDateTime createdAt, LocalDateTime updatedAt) {
        public static ScheduleView of(Schedule s) {
            return new ScheduleView(s.getId(), s.getName(), s.getPeriodStartDate(),
                    s.getPeriodEndDate(), s.getCreatedAt(), s.getUpdatedAt());
        }
    }

    public record CourseView(Long id, Long scheduleId, String name, String location, String teacher,
                             Integer dayOfWeek, Integer startPeriod, Integer endPeriod,
                             List<Integer> weeks, LocalDateTime createdAt, LocalDateTime updatedAt) {
        public static CourseView of(Course c) {
            return new CourseView(c.getId(), c.getScheduleId(), c.getName(), c.getLocation(),
                    c.getTeacher(), c.getDayOfWeek(), c.getStartPeriod(), c.getEndPeriod(),
                    c.getWeeks(), c.getCreatedAt(), c.getUpdatedAt());
        }
    }

    public record ExamView(Long id, Long scheduleId, String name, String location,
                           LocalDate examDate, LocalTime startTime, LocalTime endTime,
                           LocalDateTime createdAt, LocalDateTime updatedAt) {
        public static ExamView of(Exam e) {
            return new ExamView(e.getId(), e.getScheduleId(), e.getName(), e.getLocation(),
                    e.getExamDate(), e.getStartTime(), e.getEndTime(),
                    e.getCreatedAt(), e.getUpdatedAt());
        }
    }

    public record TodoView(Long id, String title, LocalDateTime ddl, Boolean completed,
                           Long recurringId, Long examId, LocalDateTime createdAt,
                           LocalDateTime updatedAt) {
        public static TodoView of(Todo t) {
            return new TodoView(t.getId(), t.getTitle(), t.getDdl(), t.getCompleted(),
                    t.getRecurringId(), t.getExamId(), t.getCreatedAt(), t.getUpdatedAt());
        }
    }

    public record RecurringView(Long id, String title, String frequency, Integer dayOfWeek,
                                Integer dayOfMonth, LocalTime triggerTime, String script,
                                Integer ddlOffsetMinutes, Boolean enabled, Boolean chainAfterComplete,
                                LocalDateTime lastTriggeredAt, LocalDateTime nextTriggerAt,
                                LocalDateTime createdAt, LocalDateTime updatedAt) {
        public static RecurringView of(RecurringTodo r) {
            return new RecurringView(r.getId(), r.getTitle(), r.getFrequency(), r.getDayOfWeek(),
                    r.getDayOfMonth(), r.getTriggerTime(), r.getScript(), r.getDdlOffsetMinutes(),
                    r.getEnabled(), r.getChainAfterComplete(), r.getLastTriggeredAt(),
                    r.getNextTriggerAt(), r.getCreatedAt(), r.getUpdatedAt());
        }
    }
}
