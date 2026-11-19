package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.dto.ScheduleRequest;
import com.timetable.entity.Schedule;
import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.Todo;
import com.timetable.entity.AiConversation;
import com.timetable.entity.AiAction;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.mapper.ExamMapper;
import com.timetable.mapper.TodoMapper;
import com.timetable.mapper.AiConversationMapper;
import com.timetable.mapper.AiActionMapper;
import com.timetable.mapper.ScheduleMapper;
import com.timetable.service.ScheduleService;
import com.timetable.service.RequestValidationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class ScheduleServiceImpl implements ScheduleService {

    private final ScheduleMapper scheduleMapper;
    private final CourseMapper courseMapper;
    private final ExamMapper examMapper;
    private final TodoMapper todoMapper;
    private final AiConversationMapper conversationMapper;
    private final AiActionMapper actionMapper;
    private final RequestValidationService requestValidation;

    public ScheduleServiceImpl(ScheduleMapper scheduleMapper, CourseMapper courseMapper,
                               ExamMapper examMapper, TodoMapper todoMapper,
                               AiConversationMapper conversationMapper, AiActionMapper actionMapper,
                               RequestValidationService requestValidation) {
        this.scheduleMapper = scheduleMapper;
        this.courseMapper = courseMapper;
        this.examMapper = examMapper;
        this.todoMapper = todoMapper;
        this.conversationMapper = conversationMapper;
        this.actionMapper = actionMapper;
        this.requestValidation = requestValidation;
    }

    @Override
    public List<Schedule> list(String apiKey) {
        LambdaQueryWrapper<Schedule> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Schedule::getApiKey, apiKey).orderByDesc(Schedule::getCreatedAt);
        return scheduleMapper.selectList(wrapper);
    }

    @Override
    public Schedule getById(Long id, String apiKey) {
        Schedule schedule = scheduleMapper.selectById(id);
        if (schedule == null || !schedule.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "课表不存在");
        }
        return schedule;
    }

    @Override
    public Schedule getByIdForUpdate(Long id, String apiKey) {
        Schedule schedule = scheduleMapper.selectOne(Wrappers.<Schedule>lambdaQuery()
                .eq(Schedule::getId, id)
                .eq(Schedule::getApiKey, apiKey)
                .last("FOR UPDATE"));
        if (schedule == null || !schedule.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "课表不存在");
        }
        return schedule;
    }

    private void validateDateRange(ScheduleRequest request) {
        if (request.getPeriodStartDate() != null && request.getPeriodEndDate() != null
                && request.getPeriodEndDate().isBefore(request.getPeriodStartDate())) {
            throw new BusinessException(400, "学期结束日期不能早于开始日期");
        }
    }

    @Override
    public Schedule create(ScheduleRequest request, String apiKey) {
        requestValidation.requireValid(request);
        validateDateRange(request);
        Schedule schedule = new Schedule();
        schedule.setApiKey(apiKey);
        schedule.setName(request.getName());
        schedule.setPeriodStartDate(request.getPeriodStartDate());
        schedule.setPeriodEndDate(request.getPeriodEndDate());
        scheduleMapper.insert(schedule);
        return schedule;
    }

    @Override
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Schedule update(Long id, ScheduleRequest request, String apiKey) {
        requestValidation.requireValid(request);
        validateDateRange(request);
        Schedule schedule = getByIdForUpdate(id, apiKey);
        int previousMaximum = CourseServiceImpl.maximumWeek(schedule.getPeriodStartDate(), schedule.getPeriodEndDate());
        int nextMaximum = CourseServiceImpl.maximumWeek(request.getPeriodStartDate(), request.getPeriodEndDate());
        if (nextMaximum < previousMaximum) {
            List<Course> affected = courseMapper.selectList(Wrappers.<Course>lambdaQuery()
                    .eq(Course::getScheduleId, id)).stream()
                    .filter(course -> course.getWeeks() != null
                            && course.getWeeks().stream().anyMatch(week -> week != null && week > nextMaximum))
                    .toList();
            if (!affected.isEmpty()) {
                String names = affected.stream().map(Course::getName).distinct().limit(3)
                        .collect(Collectors.joining("、"));
                throw new BusinessException(409, "缩短学期会使 " + affected.size()
                        + " 门课程超出第 " + nextMaximum + " 周：" + names);
            }
        }
        schedule.setName(request.getName());
        schedule.setPeriodStartDate(request.getPeriodStartDate());
        schedule.setPeriodEndDate(request.getPeriodEndDate());
        scheduleMapper.updateById(schedule);
        // A changed semester range changes the meaning of course week numbers.
        actionMapper.update(null, Wrappers.<AiAction>lambdaUpdate()
                .eq(AiAction::getApiKey, apiKey)
                .eq(AiAction::getScheduleId, id)
                .eq(AiAction::getScope, "COURSE")
                .eq(AiAction::getActionStatus, "PENDING")
                .set(AiAction::getActionStatus, "STALE"));
        return schedule;
    }

    @Override
    @Transactional
    public void delete(Long id, String apiKey) {
        getByIdForUpdate(id, apiKey);
        List<Exam> exams = examMapper.selectList(Wrappers.<Exam>lambdaQuery()
                .eq(Exam::getScheduleId, id));
        if (!exams.isEmpty()) {
            List<Long> examIds = exams.stream().map(Exam::getId).toList();
            todoMapper.delete(Wrappers.<Todo>lambdaQuery()
                    .eq(Todo::getApiKey, apiKey)
                    .in(Todo::getExamId, examIds));
            examMapper.delete(Wrappers.<Exam>lambdaQuery().eq(Exam::getScheduleId, id));
        }
        courseMapper.delete(Wrappers.<Course>lambdaQuery().eq(Course::getScheduleId, id));
        actionMapper.update(null, Wrappers.<AiAction>lambdaUpdate()
                .eq(AiAction::getApiKey, apiKey)
                .eq(AiAction::getScheduleId, id)
                .eq(AiAction::getActionStatus, "PENDING")
                .set(AiAction::getActionStatus, "STALE"));
        conversationMapper.update(null, Wrappers.<AiConversation>lambdaUpdate()
                .eq(AiConversation::getApiKey, apiKey)
                .eq(AiConversation::getScheduleId, id)
                .set(AiConversation::getScheduleId, null));
        scheduleMapper.deleteById(id);
    }
}
