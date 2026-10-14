package com.timetable.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.AssertTrue;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.util.List;

public class CourseRequest {
    @NotBlank(message = "课程名称不能为空")
    @Size(max = 200, message = "课程名称不能超过 200 个字符")
    private String name;

    @Size(max = 200, message = "上课地点不能超过 200 个字符")
    private String location;
    @Size(max = 100, message = "教师名称不能超过 100 个字符")
    private String teacher;

    @NotNull(message = "星期不能为空")
    @Min(value = 1, message = "星期范围为 1-7")
    @Max(value = 7, message = "星期范围为 1-7")
    private Integer dayOfWeek;

    @NotNull(message = "开始节次不能为空")
    @Min(value = 1, message = "节次范围为 1-12")
    @Max(value = 12, message = "节次范围为 1-12")
    private Integer startPeriod;

    @NotNull(message = "结束节次不能为空")
    @Min(value = 1, message = "节次范围为 1-12")
    @Max(value = 12, message = "节次范围为 1-12")
    private Integer endPeriod;

    @NotEmpty(message = "周次不能为空")
    @Size(max = 52, message = "周次数量不能超过 52")
    private List<@NotNull @Min(value = 1, message = "周次必须从第 1 周开始")
            @Max(value = 52, message = "周次不能超过第 52 周") Integer> weeks;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }
    public String getTeacher() { return teacher; }
    public void setTeacher(String teacher) { this.teacher = teacher; }
    public Integer getDayOfWeek() { return dayOfWeek; }
    public void setDayOfWeek(Integer dayOfWeek) { this.dayOfWeek = dayOfWeek; }
    public Integer getStartPeriod() { return startPeriod; }
    public void setStartPeriod(Integer startPeriod) { this.startPeriod = startPeriod; }
    public Integer getEndPeriod() { return endPeriod; }
    public void setEndPeriod(Integer endPeriod) { this.endPeriod = endPeriod; }
    public List<Integer> getWeeks() { return weeks; }
    public void setWeeks(List<Integer> weeks) { this.weeks = weeks; }

    @JsonIgnore
    @AssertTrue(message = "结束节次不能小于开始节次")
    public boolean isPeriodRangeValid() {
        return startPeriod == null || endPeriod == null || endPeriod >= startPeriod;
    }
}
