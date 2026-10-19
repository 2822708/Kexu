package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.FocusCourseCompletionRequest;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.FocusService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@Validated
@RestController
@RequestMapping("/api/focus/course-completions")
public class FocusController {
    private final FocusService focusService;

    public FocusController(FocusService focusService) {
        this.focusService = focusService;
    }

    @GetMapping
    public ApiResponse<List<Long>> list(@RequestParam @Positive Long scheduleId,
                                        @RequestParam LocalDate date) {
        return ApiResponse.success(focusService.completedCourseIds(
                scheduleId, date, RequestContext.getApiKey()));
    }

    @PutMapping("/{courseId}")
    public ApiResponse<Void> setCompleted(@PathVariable @Positive Long courseId,
                                          @Valid @RequestBody FocusCourseCompletionRequest request) {
        focusService.setCourseCompleted(request.getScheduleId(), courseId, request.getDate(),
                request.getCompleted(), RequestContext.getApiKey());
        return ApiResponse.success(null);
    }
}
