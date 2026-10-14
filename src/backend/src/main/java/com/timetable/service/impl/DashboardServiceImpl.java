package com.timetable.service.impl;

import com.timetable.dto.DashboardDto;
import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.StudentProfile;
import com.timetable.entity.Task;
import com.timetable.service.CourseService;
import com.timetable.service.DashboardService;
import com.timetable.service.ExamService;
import com.timetable.service.ScheduleService;
import com.timetable.service.StudentProfileService;
import com.timetable.service.TaskService;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Service
public class DashboardServiceImpl implements DashboardService {

    /** 「即将截止」窗口：48 小时（方案 §2.6 今日重点规则）。 */
    private static final int UPCOMING_HORIZON_HOURS = 48;
    /** 考试倒计时展示窗口：14 天。 */
    private static final int EXAM_HORIZON_DAYS = 14;

    private final ScheduleService scheduleService;
    private final CourseService courseService;
    private final ExamService examService;
    private final TaskService taskService;
    private final StudentProfileService studentProfileService;
    private final Clock clock;

    public DashboardServiceImpl(ScheduleService scheduleService, CourseService courseService,
                                ExamService examService, TaskService taskService,
                                StudentProfileService studentProfileService, Clock clock) {
        this.scheduleService = scheduleService;
        this.courseService = courseService;
        this.examService = examService;
        this.taskService = taskService;
        this.studentProfileService = studentProfileService;
        this.clock = clock;
    }

    @Override
    public DashboardDto dashboard(LocalDate date, Long scheduleId, String apiKey) {
        LocalDate today = date == null ? LocalDate.now(clock) : date;
        LocalDateTime dayStart = today.atStartOfDay();
        LocalDateTime dayEnd = today.atTime(LocalTime.MAX);
        LocalDateTime horizon = dayStart.plusHours(UPCOMING_HORIZON_HOURS);

        Long effectiveScheduleId = scheduleId;
        if (effectiveScheduleId == null) {
            effectiveScheduleId = scheduleService.list(apiKey).stream()
                    .findFirst().map(com.timetable.entity.Schedule::getId).orElse(null);
        }

        DashboardDto dto = new DashboardDto();
        dto.setDate(today);

        // 档案：未建档也返回 200，前端显示「你好，同学」+ 填写入口
        StudentProfile profile = studentProfileService.find(apiKey);
        dto.setProfile(profile);
        dto.setProfilePresent(profile != null);
        dto.setGreetingName(profile == null || profile.getName() == null || profile.getName().isBlank()
                ? null : profile.getName());

        // 今日课程：星期命中 + 教学周命中（与 TimetableGrid 的可见性规则一致）
        if (effectiveScheduleId != null) {
            com.timetable.entity.Schedule schedule = scheduleService.getById(effectiveScheduleId, apiKey);
            int currentWeek = AiPromptBuilder.weekOf(schedule.getPeriodStartDate(), today);
            List<Course> todayCourses = new ArrayList<>();
            for (Course course : courseService.listByScheduleId(effectiveScheduleId, apiKey)) {
                boolean dayHit = course.getDayOfWeek() != null
                        && course.getDayOfWeek() == today.getDayOfWeek().getValue();
                boolean weekHit = course.getWeeks() == null || course.getWeeks().contains(currentWeek);
                if (dayHit && weekHit) {
                    todayCourses.add(course);
                }
            }
            todayCourses.sort((a, b) -> {
                int byStart = Integer.compare(
                        a.getStartPeriod() == null ? 0 : a.getStartPeriod(),
                        b.getStartPeriod() == null ? 0 : b.getStartPeriod());
                return byStart != 0 ? byStart : Long.compare(
                        a.getId() == null ? 0 : a.getId(), b.getId() == null ? 0 : b.getId());
            });
            dto.setTodayCourses(todayCourses);

            // 考试倒计时：今天起 14 天内
            List<Exam> upcomingExams = new ArrayList<>();
            for (Exam exam : examService.listByScheduleId(effectiveScheduleId, apiKey)) {
                if (exam.getExamDate() != null
                        && !exam.getExamDate().isBefore(today)
                        && !exam.getExamDate().isAfter(today.plusDays(EXAM_HORIZON_DAYS))) {
                    upcomingExams.add(exam);
                }
            }
            upcomingExams.sort((a, b) -> a.getExamDate().compareTo(b.getExamDate()));
            dto.setUpcomingExams(upcomingExams);
        }

        // 今日任务：未完成且（今天截止 / 已逾期 / 无截止）；48h 截止单列
        List<Task> openTasks = taskService.listOpen(apiKey, dayStart);
        List<Task> todayTasks = new ArrayList<>();
        List<Task> upcomingDeadlines = new ArrayList<>();
        for (Task task : openTasks) {
            if (task.getDeadline() == null) {
                todayTasks.add(task);
            } else if (task.getDeadline().isBefore(dayStart)) {
                todayTasks.add(task); // 已逾期
            } else if (!task.getDeadline().isAfter(dayEnd)) {
                todayTasks.add(task); // 今天截止
            } else if (!task.getDeadline().isAfter(horizon)) {
                upcomingDeadlines.add(task); // 48h 内
            }
        }
        dto.setTodayTasks(todayTasks);
        dto.setUpcomingDeadlines(upcomingDeadlines);

        // 今日重点（规则计算，确定性输出）
        List<String> highlights = new ArrayList<>();
        for (Task task : todayTasks) {
            if (task.getDeadline() != null && task.getDeadline().isBefore(dayStart)) {
                long overdueDays = ChronoUnit.DAYS.between(task.getDeadline().toLocalDate(), today);
                highlights.add("「" + task.getTitle() + "」已逾期 " + Math.max(overdueDays, 1) + " 天");
            } else if (task.getDeadline() != null && !task.getDeadline().isAfter(dayEnd)) {
                highlights.add("「" + task.getTitle() + "」今天截止");
            }
        }
        for (Task task : upcomingDeadlines) {
            long hours = ChronoUnit.HOURS.between(dayStart, task.getDeadline());
            highlights.add("「" + task.getTitle() + "」将在 " + Math.max(hours, 1) + " 小时后截止");
        }
        for (Exam exam : dto.getUpcomingExams()) {
            long days = ChronoUnit.DAYS.between(today, exam.getExamDate());
            highlights.add(days == 0
                    ? "「" + exam.getName() + "」今天考试"
                    : "「" + exam.getName() + "」还有 " + days + " 天考试");
        }
        dto.setTodayHighlights(highlights);

        // planSummary：Step 6「AI 每日计划」接入前保持 null，前端隐藏该卡片
        return dto;
    }
}
