package com.timetable.dto;

import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * AI Dashboard 聚合响应（AI Campus Agent V1.0 Step 5）。
 *
 * 一次请求替代前端 N 次串行：档案 + 今日课程 + 今日任务 + 48h 截止 + 考试倒计时
 * + 规则计算的今日重点。planSummary 为 Step 6「AI 每日计划」占位，暂为 null。
 */
public class DashboardDto {

    private LocalDate date;
    /** 档案姓名；未建档为 null（前端显示「你好，同学」并引导填写）。 */
    private String greetingName;
    private boolean profilePresent;
    private StudentProfile profile;
    private List<Course> todayCourses = new ArrayList<>();
    /** 今日任务：未完成且（今天截止 / 已逾期 / 无截止）。 */
    private List<Task> todayTasks = new ArrayList<>();
    /** 48 小时内截止的未完成任务（不含已逾期——那批在 todayTasks 里）。 */
    private List<Task> upcomingDeadlines = new ArrayList<>();
    /** 今天起 14 天内的考试（倒计时）。 */
    private List<Exam> upcomingExams = new ArrayList<>();
    /** 规则计算的今日重点（不烧 token，保证确定性）：逾期 / 48h 截止 / 考试倒计时。 */
    private List<String> todayHighlights = new ArrayList<>();
    /** Step 6 占位：AI 每日计划摘要。 */
    private String planSummary;

    public LocalDate getDate() { return date; }
    public void setDate(LocalDate date) { this.date = date; }

    public String getGreetingName() { return greetingName; }
    public void setGreetingName(String greetingName) { this.greetingName = greetingName; }

    public boolean isProfilePresent() { return profilePresent; }
    public void setProfilePresent(boolean profilePresent) { this.profilePresent = profilePresent; }

    public StudentProfile getProfile() { return profile; }
    public void setProfile(StudentProfile profile) { this.profile = profile; }

    public List<Course> getTodayCourses() { return todayCourses; }
    public void setTodayCourses(List<Course> todayCourses) {
        this.todayCourses = todayCourses == null ? new ArrayList<>() : todayCourses;
    }

    public List<Task> getTodayTasks() { return todayTasks; }
    public void setTodayTasks(List<Task> todayTasks) {
        this.todayTasks = todayTasks == null ? new ArrayList<>() : todayTasks;
    }

    public List<Task> getUpcomingDeadlines() { return upcomingDeadlines; }
    public void setUpcomingDeadlines(List<Task> upcomingDeadlines) {
        this.upcomingDeadlines = upcomingDeadlines == null ? new ArrayList<>() : upcomingDeadlines;
    }

    public List<Exam> getUpcomingExams() { return upcomingExams; }
    public void setUpcomingExams(List<Exam> upcomingExams) {
        this.upcomingExams = upcomingExams == null ? new ArrayList<>() : upcomingExams;
    }

    public List<String> getTodayHighlights() { return todayHighlights; }
    public void setTodayHighlights(List<String> todayHighlights) {
        this.todayHighlights = todayHighlights == null ? new ArrayList<>() : todayHighlights;
    }

    public String getPlanSummary() { return planSummary; }
    public void setPlanSummary(String planSummary) { this.planSummary = planSummary; }
}
