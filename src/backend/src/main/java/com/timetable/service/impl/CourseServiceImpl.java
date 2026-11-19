package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.dto.BatchCourseRequest;
import com.timetable.dto.CourseRequest;
import com.timetable.entity.Course;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.service.CourseService;
import com.timetable.service.RequestValidationService;
import com.timetable.service.ScheduleService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

@Service
public class CourseServiceImpl implements CourseService {

    private final CourseMapper courseMapper;
    private final ScheduleService scheduleService;
    private final RequestValidationService requestValidation;

    public CourseServiceImpl(CourseMapper courseMapper, ScheduleService scheduleService,
                             RequestValidationService requestValidation) {
        this.courseMapper = courseMapper;
        this.scheduleService = scheduleService;
        this.requestValidation = requestValidation;
    }

    static int maximumWeek(LocalDate start, LocalDate end) {
        return start == null || end == null ? 52 : Math.min(52, Math.max(1, AiPromptBuilder.weekOf(start, end)));
    }

    private void validateWeeks(CourseRequest request, Schedule schedule) {
        List<Integer> weeks = request.getWeeks();
        if (weeks == null) {
            throw new BusinessException(400, "周次不能为空");
        }
        int maximum = maximumWeek(schedule.getPeriodStartDate(), schedule.getPeriodEndDate());
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
        scheduleService.getById(scheduleId, apiKey);
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
        scheduleService.getById(course.getScheduleId(), apiKey);
        return course.getScheduleId();
    }

    @Override
    @Transactional
    public Course create(Long scheduleId, CourseRequest request, String apiKey) {
        Schedule schedule = scheduleService.getByIdForUpdate(scheduleId, apiKey);
        Course course = prepareCourse(schedule, request);
        courseMapper.insert(course);
        return course;
    }

    private Course prepareCourse(Schedule schedule, CourseRequest request) {
        requestValidation.requireValid(request);
        validatePeriods(request);
        validateWeeks(request, schedule);
        Course course = new Course();
        course.setScheduleId(schedule.getId());
        course.setName(request.getName());
        course.setLocation(request.getLocation());
        course.setTeacher(request.getTeacher());
        course.setDayOfWeek(request.getDayOfWeek());
        course.setStartPeriod(request.getStartPeriod());
        course.setEndPeriod(request.getEndPeriod());
        course.setWeeks(request.getWeeks());
        return course;
    }

    @Override
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public List<Course> batchCreate(Long scheduleId, BatchCourseRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Schedule schedule = scheduleService.getByIdForUpdate(scheduleId, apiKey);
        Set<CourseIdentity> identities = new HashSet<>();
        courseMapper.selectList(Wrappers.<Course>lambdaQuery().eq(Course::getScheduleId, scheduleId))
                .forEach(course -> identities.add(identityOf(course)));
        List<Course> result = new ArrayList<>();
        for (CourseRequest req : request.getCourses()) {
            Course course = prepareCourse(schedule, req);
            if (!identities.add(identityOf(course))) {
                throw new BusinessException(409, "课程「" + course.getName() + "」完全重复，本批未导入");
            }
            result.add(course);
        }
        result.forEach(courseMapper::insert);
        return result;
    }

    private record CourseIdentity(String name, String location, String teacher,
                                  Integer day, Integer start, Integer end, List<Integer> weeks) {}

    private CourseIdentity identityOf(Course course) {
        List<Integer> weeks = course.getWeeks() == null ? List.of()
                : course.getWeeks().stream().filter(Objects::nonNull).distinct().sorted().toList();
        return new CourseIdentity(normalize(course.getName()), normalize(course.getLocation()),
                normalize(course.getTeacher()), course.getDayOfWeek(), course.getStartPeriod(),
                course.getEndPeriod(), weeks);
    }

    private String normalize(String value) {
        return value == null ? "" : value.strip();
    }

    @Override
    @Transactional
    public Course update(Long id, CourseRequest request, String apiKey) {
        return update(id, null, request, apiKey);
    }

    @Override
    @Transactional
    public Course update(Long id, Long expectedScheduleId, CourseRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Course course = courseMapper.selectById(id);
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        Schedule schedule = scheduleService.getByIdForUpdate(course.getScheduleId(), apiKey);
        course = courseMapper.selectOne(Wrappers.<Course>lambdaQuery().eq(Course::getId, id).last("FOR UPDATE"));
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        if (expectedScheduleId != null && !expectedScheduleId.equals(course.getScheduleId())) {
            throw new BusinessException(404, "课程不属于当前课表");
        }
        validatePeriods(request);
        validateWeeks(request, schedule);
        course.setName(request.getName());
        if (request.isLocationProvided()) {
            course.setLocation(request.getLocation());
        }
        if (request.isTeacherProvided()) {
            course.setTeacher(request.getTeacher());
        }
        course.setDayOfWeek(request.getDayOfWeek());
        course.setStartPeriod(request.getStartPeriod());
        course.setEndPeriod(request.getEndPeriod());
        course.setWeeks(request.getWeeks());
        courseMapper.update(course, Wrappers.<Course>lambdaUpdate()
                .eq(Course::getId, id)
                .set(request.isLocationProvided() && course.getLocation() == null, Course::getLocation, null)
                .set(request.isTeacherProvided() && course.getTeacher() == null, Course::getTeacher, null));
        return course;
    }

    @Override
    @Transactional
    public void delete(Long id, String apiKey) {
        delete(id, null, apiKey);
    }

    @Override
    @Transactional
    public void delete(Long id, Long expectedScheduleId, String apiKey) {
        Course course = courseMapper.selectById(id);
        if (course == null) {
            throw new BusinessException(404, "课程不存在");
        }
        scheduleService.getByIdForUpdate(course.getScheduleId(), apiKey);
        if (expectedScheduleId != null && !expectedScheduleId.equals(course.getScheduleId())) {
            throw new BusinessException(404, "课程不属于当前课表");
        }
        courseMapper.deleteById(id);
    }
}
