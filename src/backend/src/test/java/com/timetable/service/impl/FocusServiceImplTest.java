package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.timetable.entity.Course;
import com.timetable.entity.FocusCourseCompletion;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.mapper.FocusCourseCompletionMapper;
import com.timetable.service.ScheduleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FocusServiceImplTest {
    @Mock private FocusCourseCompletionMapper completionMapper;
    @Mock private CourseMapper courseMapper;
    @Mock private ScheduleService scheduleService;

    private FocusServiceImpl service;
    private final LocalDate classDate = LocalDate.of(2026, 9, 7);

    @BeforeEach
    void setUp() {
        service = new FocusServiceImpl(completionMapper, courseMapper, scheduleService);
        Schedule schedule = new Schedule();
        schedule.setId(11L);
        schedule.setPeriodStartDate(LocalDate.of(2026, 9, 1));
        schedule.setPeriodEndDate(LocalDate.of(2027, 1, 31));
        when(scheduleService.getById(11L, "user-key")).thenReturn(schedule);

        Course course = new Course();
        course.setId(21L);
        course.setScheduleId(11L);
        course.setDayOfWeek(1);
        course.setWeeks(List.of(2));
        when(courseMapper.selectById(21L)).thenReturn(course);
    }

    @Test
    void recordsAndRemovesCompletionForOneCourseOccurrence() {
        FocusCourseCompletion existing = new FocusCourseCompletion();
        existing.setId(31L);
        when(completionMapper.selectOne(any(Wrapper.class))).thenReturn(null, existing);

        service.setCourseCompleted(11L, 21L, classDate, true, "user-key");
        service.setCourseCompleted(11L, 21L, classDate, false, "user-key");

        verify(completionMapper).insert(any(FocusCourseCompletion.class));
        verify(completionMapper).deleteById(31L);
    }

    @Test
    void refusesToMarkCourseCompleteOnAnUnscheduledDay() {
        assertThatThrownBy(() -> service.setCourseCompleted(
                11L, 21L, classDate.plusDays(1), true, "user-key"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("上课日");

        verify(completionMapper, never()).insert(any(FocusCourseCompletion.class));
    }
}
