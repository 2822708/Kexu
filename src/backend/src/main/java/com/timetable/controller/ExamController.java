package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.ExamRequest;
import com.timetable.entity.Exam;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.AiService;
import com.timetable.service.ExamService;
import com.timetable.service.impl.AiServiceImpl;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class ExamController {

    private final ExamService examService;
    private final AiService aiService;

    public ExamController(ExamService examService, AiService aiService) {
        this.examService = examService;
        this.aiService = aiService;
    }

    @GetMapping("/schedules/{scheduleId}/exams")
    public ApiResponse<List<Exam>> listBySchedule(@PathVariable Long scheduleId) {
        return ApiResponse.success(examService.listByScheduleId(scheduleId, RequestContext.getApiKey()));
    }

    @PostMapping("/schedules/{scheduleId}/exams")
    public ApiResponse<Exam> create(@PathVariable Long scheduleId, @Valid @RequestBody ExamRequest request) {
        String apiKey = RequestContext.getApiKey();
        Exam exam = examService.create(scheduleId, request, apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_COURSE, scheduleId);
        return ApiResponse.success(exam);
    }

    @PutMapping("/exams/{id}")
    public ApiResponse<Exam> update(@PathVariable Long id, @Valid @RequestBody ExamRequest request) {
        String apiKey = RequestContext.getApiKey();
        Exam exam = examService.update(id, request, apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_COURSE, exam.getScheduleId());
        return ApiResponse.success(exam);
    }

    @DeleteMapping("/exams/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        String apiKey = RequestContext.getApiKey();
        Long scheduleId = examService.getScheduleId(id, apiKey);
        examService.delete(id, apiKey);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_COURSE, scheduleId);
        return ApiResponse.success(null);
    }
}
