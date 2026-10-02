package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.entity.Course;
import com.timetable.entity.FocusCourseCompletion;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.mapper.FocusCourseCompletionMapper;
import com.timetable.service.FocusService;
import com.timetable.service.ScheduleService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.List;

@Service
public class FocusServiceImpl implements FocusService {
    private final FocusCourseCompletionMapper completionMapper;
    private final CourseMapper courseMapper;
    private final ScheduleService scheduleService;

    public FocusServiceImpl(FocusCourseCompletionMapper completionMapper,
                            CourseMapper courseMapper,
                            ScheduleService scheduleService) {
        this.completionMapper = completionMapper;
        this.courseMapper = courseMapper;
        this.scheduleService = scheduleService;
    }

    @Override
    public List<Long> completedCourseIds(Long scheduleId, LocalDate date, String apiKey) {
        scheduleService.getById(scheduleId, apiKey);
        LambdaQueryWrapper<FocusCourseCompletion> query = new LambdaQueryWrapper<>();
        query.select(FocusCourseCompletion::getCourseId)
                .eq(FocusCourseCompletion::getApiKey, apiKey)
                .eq(FocusCourseCompletion::getScheduleId, scheduleId)
                .eq(FocusCourseCompletion::getOccurrenceDate, date);
        return completionMapper.selectList(query).stream()
                .map(FocusCourseCompletion::getCourseId)
                .toList();
    }

    @Override
    @Transactional
    public void setCourseCompleted(Long scheduleId, Long courseId, LocalDate date,
                                   boolean completed, String apiKey) {
        Schedule schedule = scheduleService.getById(scheduleId, apiKey);
        Course course = courseMapper.selectById(courseId);
        if (course == null || !scheduleId.equals(course.getScheduleId())) {
            throw new BusinessException(404, "课程不存在");
        }
        validateOccurrence(schedule, course, date);

        LambdaQueryWrapper<FocusCourseCompletion> query = new LambdaQueryWrapper<>();
        query.eq(FocusCourseCompletion::getApiKey, apiKey)
                .eq(FocusCourseCompletion::getScheduleId, scheduleId)
                .eq(FocusCourseCompletion::getCourseId, courseId)
                .eq(FocusCourseCompletion::getOccurrenceDate, date);
        FocusCourseCompletion existing = completionMapper.selectOne(query);
        if (completed && existing == null) {
            FocusCourseCompletion record = new FocusCourseCompletion();
            record.setApiKey(apiKey);
            record.setScheduleId(scheduleId);
            record.setCourseId(courseId);
            record.setOccurrenceDate(date);
            completionMapper.insert(record);
        } else if (!completed && existing != null) {
            completionMapper.deleteById(existing.getId());
        }
    }

    private void validateOccurrence(Schedule schedule, Course course, LocalDate date) {
        LocalDate first = schedule.getPeriodStartDate();
        LocalDate last = schedule.getPeriodEndDate();
        if (date.isBefore(first) || date.isAfter(last)) {
            throw new BusinessException(400, "日期不在当前学期内");
        }
        if (date.getDayOfWeek().getValue() != course.getDayOfWeek()) {
            throw new BusinessException(400, "该日期不是这门课程的上课日");
        }
        LocalDate firstMonday = first.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate targetMonday = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        int week = Math.toIntExact(ChronoUnit.WEEKS.between(firstMonday, targetMonday)) + 1;
        if (course.getWeeks() == null || !course.getWeeks().contains(week)) {
            throw new BusinessException(400, "该周没有安排这门课程");
        }
    }
}
