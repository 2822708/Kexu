package com.timetable.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public class BatchCourseRequest {
    @NotEmpty(message = "课程列表不能为空")
    @Size(max = 200, message = "每次最多导入 200 门课程")
    @Valid
    private List<CourseRequest> courses;

    public List<CourseRequest> getCourses() { return courses; }
    public void setCourses(List<CourseRequest> courses) { this.courses = courses; }
}
