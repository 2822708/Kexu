package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDate;
import java.time.LocalDateTime;

@TableName("focus_course_completion")
public class FocusCourseCompletion {
    @TableId(type = IdType.AUTO)
    private Long id;
    @JsonIgnore
    private String apiKey;
    private Long scheduleId;
    private Long courseId;
    private LocalDate occurrenceDate;
    private LocalDateTime completedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public Long getScheduleId() { return scheduleId; }
    public void setScheduleId(Long scheduleId) { this.scheduleId = scheduleId; }
    public Long getCourseId() { return courseId; }
    public void setCourseId(Long courseId) { this.courseId = courseId; }
    public LocalDate getOccurrenceDate() { return occurrenceDate; }
    public void setOccurrenceDate(LocalDate occurrenceDate) { this.occurrenceDate = occurrenceDate; }
    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
}
