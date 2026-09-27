package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.timetable.dto.ExamRequest;
import com.timetable.entity.Exam;
import com.timetable.entity.Schedule;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.ExamMapper;
import com.timetable.mapper.ScheduleMapper;
import com.timetable.service.ExamService;
import com.timetable.service.RequestValidationService;
import com.timetable.service.TodoService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class ExamServiceImpl implements ExamService {

    private final ExamMapper examMapper;
    private final ScheduleMapper scheduleMapper;
    private final TodoService todoService;
    private final RequestValidationService requestValidation;

    public ExamServiceImpl(ExamMapper examMapper,
                           ScheduleMapper scheduleMapper, TodoService todoService,
                           RequestValidationService requestValidation) {
        this.examMapper = examMapper;
        this.scheduleMapper = scheduleMapper;
        this.todoService = todoService;
        this.requestValidation = requestValidation;
    }

    private void verifyScheduleOwnership(Long scheduleId, String apiKey) {
        Schedule schedule = scheduleMapper.selectById(scheduleId);
        if (schedule == null || !schedule.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "课表不存在");
        }
    }

    private void validateTimes(ExamRequest request) {
        if (!request.getEndTime().isAfter(request.getStartTime())) {
            throw new BusinessException(400, "结束时间必须晚于开始时间");
        }
    }

    private void apply(Exam exam, ExamRequest request) {
        exam.setName(request.getName());
        exam.setLocation(request.getLocation());
        exam.setExamDate(request.getExamDate());
        exam.setStartTime(request.getStartTime());
        exam.setEndTime(request.getEndTime());
    }

    @Override
    public List<Exam> listByScheduleId(Long scheduleId, String apiKey) {
        verifyScheduleOwnership(scheduleId, apiKey);
        LambdaQueryWrapper<Exam> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Exam::getScheduleId, scheduleId)
                .orderByAsc(Exam::getExamDate, Exam::getStartTime);
        return examMapper.selectList(wrapper);
    }

    @Override
    public Long getScheduleId(Long id, String apiKey) {
        Exam exam = examMapper.selectById(id);
        if (exam == null) {
            throw new BusinessException(404, "考试记录不存在");
        }
        verifyScheduleOwnership(exam.getScheduleId(), apiKey);
        return exam.getScheduleId();
    }

    @Override
    @Transactional
    public Exam create(Long scheduleId, ExamRequest request, String apiKey) {
        requestValidation.requireValid(request);
        verifyScheduleOwnership(scheduleId, apiKey);
        validateTimes(request);
        Exam exam = new Exam();
        exam.setScheduleId(scheduleId);
        apply(exam, request);
        examMapper.insert(exam);
        // 自动关联一条待办：ddl=考试开始时间，考试结束后由调度器自动完成
        todoService.createForExam(exam.getId(), exam.getName(),
                LocalDateTime.of(exam.getExamDate(), exam.getStartTime()), apiKey);
        return exam;
    }

    @Override
    @Transactional
    public Exam update(Long id, ExamRequest request, String apiKey) {
        return update(id, null, request, apiKey);
    }

    @Override
    @Transactional
    public Exam update(Long id, Long expectedScheduleId, ExamRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Exam exam = examMapper.selectById(id);
        if (exam == null) {
            throw new BusinessException(404, "考试记录不存在");
        }
        verifyScheduleOwnership(exam.getScheduleId(), apiKey);
        if (expectedScheduleId != null && !expectedScheduleId.equals(exam.getScheduleId())) {
            throw new BusinessException(404, "考试记录不属于当前课表");
        }
        validateTimes(request);
        apply(exam, request);
        examMapper.updateById(exam);
        // 同步关联待办的标题与截止时间
        todoService.updateExamLinked(exam.getId(), exam.getName(),
                LocalDateTime.of(exam.getExamDate(), exam.getStartTime()), apiKey);
        return exam;
    }

    @Override
    @Transactional
    public void delete(Long id, String apiKey) {
        delete(id, null, apiKey);
    }

    @Override
    @Transactional
    public void delete(Long id, Long expectedScheduleId, String apiKey) {
        Exam exam = examMapper.selectById(id);
        if (exam == null) {
            throw new BusinessException(404, "考试记录不存在");
        }
        verifyScheduleOwnership(exam.getScheduleId(), apiKey);
        if (expectedScheduleId != null && !expectedScheduleId.equals(exam.getScheduleId())) {
            throw new BusinessException(404, "考试记录不属于当前课表");
        }
        // 删除考试时一并清理其自动关联的待办
        todoService.deleteByExamId(exam.getId(), apiKey);
        examMapper.deleteById(id);
    }
}
