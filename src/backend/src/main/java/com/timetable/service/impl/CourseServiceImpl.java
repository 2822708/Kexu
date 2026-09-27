package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.dto.BatchCourseRequest;
import com.timetable.dto.CourseRequest;
import com.timetable.entity.Course;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.mapper.ScheduleMapper;
import com.timetable.service.CourseService;
import com.timetable.service.RequestValidationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class CourseServiceImpl implements CourseService {

    private final CourseMapper courseMapper;
    private final ScheduleMapper scheduleMapper;
    private final RequestValidationService requestValidation;

    public CourseServiceImpl(CourseMapper courseMapper, ScheduleMapper scheduleMapper,
                             RequestValidationService requestValidation) {
        this.courseMapper = courseMapper;
        this.scheduleMapper = scheduleMapper;
        this.requestValidation = requestValidation;
    }

    private Schedule verifyScheduleOwnership(Long scheduleId, String apiKey) {
        Schedule schedule = scheduleMapper.selectById(scheduleId);
        if (schedule == null || !schedule.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "课表不存在");
        }
        return schedule;
    }

    private void validateWeeks(CourseRequest request, Schedule schedule) {
        List<Integer> weeks = request.getWeeks();
        if (weeks == null) {
            throw new BusinessException(400, "周次不能为空");
        }
        int maximum = 52;
        if (schedule.getPeriodStartDate() != null && schedule.getPeriodEndDate() != null) {
            maximum = Math.min(52, Math.max(1, AiPromptBuilder.weekOf(
                    schedule.getPeriodStartDate(), schedule.getPeriodEndDate())));
        }
        for (Integer week : weeks) {
            if (week == null || week < 1 || week > maximum) {
                throw new BusinessException(400, "课程周次须在第 1 至第 " + maximum + " 周之间");
            }
        }
    }

    private void validatePeriods(CourseRequest request) {
        if (request.getStartPeriod() != null && request.getEndPeriod() != null
                && request.getEndPeriod() < request.getStartPeriod()) {
            throw new BusinessException(400, "结束节次不能小于开始节次");
        }
    }

    @Override
    public List<Course> listByScheduleId(Long scheduleId, String apiKey) {
        verifyScheduleOwnership(scheduleId, apiKey);
        LambdaQueryWrapper<Course> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Course::getScheduleId, scheduleId).orderByAsc(Course::getDayOfWeek, Course::getStartPeriod);
        return courseMapper.selectList(wrapper);
    }

    @Override
    public Long getScheduleId(Long id, String apiKey) {
        Course course = courseMapper.selectById(id);
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        verifyScheduleOwnership(course.getScheduleId(), apiKey);
        return course.getScheduleId();
    }

    @Override
    public Course create(Long scheduleId, CourseRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Schedule schedule = verifyScheduleOwnership(scheduleId, apiKey);
        validatePeriods(request);
        validateWeeks(request, schedule);
        Course course = new Course();
        course.setScheduleId(scheduleId);
        course.setName(request.getName());
        course.setLocation(request.getLocation());
        course.setTeacher(request.getTeacher());
        course.setDayOfWeek(request.getDayOfWeek());
        course.setStartPeriod(request.getStartPeriod());
        course.setEndPeriod(request.getEndPeriod());
        course.setWeeks(request.getWeeks());
        courseMapper.insert(course);
        return course;
    }

    @Override
    @Transactional
    public List<Course> batchCreate(Long scheduleId, BatchCourseRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Schedule schedule = verifyScheduleOwnership(scheduleId, apiKey);
        List<Course> result = new ArrayList<>();
        for (CourseRequest req : request.getCourses()) {
            requestValidation.requireValid(req);
            validatePeriods(req);
            validateWeeks(req, schedule);
            Course course = new Course();
            course.setScheduleId(scheduleId);
            course.setName(req.getName());
            course.setLocation(req.getLocation());
            course.setTeacher(req.getTeacher());
            course.setDayOfWeek(req.getDayOfWeek());
            course.setStartPeriod(req.getStartPeriod());
            course.setEndPeriod(req.getEndPeriod());
            course.setWeeks(req.getWeeks());
            courseMapper.insert(course);
            result.add(course);
        }
        return result;
    }

    @Override
    public Course update(Long id, CourseRequest request, String apiKey) {
        return update(id, null, request, apiKey);
    }

    @Override
    public Course update(Long id, Long expectedScheduleId, CourseRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Course course = courseMapper.selectById(id);
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        Schedule schedule = verifyScheduleOwnership(course.getScheduleId(), apiKey);
        if (expectedScheduleId != null && !expectedScheduleId.equals(course.getScheduleId())) {
            throw new BusinessException(404, "课程不属于当前课表");
        }
        validatePeriods(request);
        validateWeeks(request, schedule);
        course.setName(request.getName());
        course.setLocation(request.getLocation());
        course.setTeacher(request.getTeacher());
        course.setDayOfWeek(request.getDayOfWeek());
        course.setStartPeriod(request.getStartPeriod());
        course.setEndPeriod(request.getEndPeriod());
        course.setWeeks(request.getWeeks());
        courseMapper.updateById(course);
        return course;
    }

    @Override
    public void delete(Long id, String apiKey) {
        delete(id, null, apiKey);
    }

    @Override
    public void delete(Long id, Long expectedScheduleId, String apiKey) {
        Course course = courseMapper.selectById(id);
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        verifyScheduleOwnership(course.getScheduleId(), apiKey);
        if (expectedScheduleId != null && !expectedScheduleId.equals(course.getScheduleId())) {
            throw new BusinessException(404, "课程不属于当前课表");
        }
        courseMapper.deleteById(id);
    }
}
