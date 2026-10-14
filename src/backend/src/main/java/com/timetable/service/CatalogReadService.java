package com.timetable.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.timetable.dto.CatalogViews;
import com.timetable.dto.PageResult;
import com.timetable.entity.Course;
import com.timetable.entity.Exam;
import com.timetable.entity.RecurringTodo;
import com.timetable.entity.Schedule;
import com.timetable.entity.Todo;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.CourseMapper;
import com.timetable.mapper.ExamMapper;
import com.timetable.mapper.RecurringTodoMapper;
import com.timetable.mapper.ScheduleMapper;
import com.timetable.mapper.TodoMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.function.Function;

/** Bounded and filtered read endpoints; the legacy list APIs remain compatible. */
@Service
public class CatalogReadService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_OFFSET = 100_000;

    private final ScheduleService scheduleService;
    private final ScheduleMapper scheduleMapper;
    private final CourseMapper courseMapper;
    private final ExamMapper examMapper;
    private final TodoMapper todoMapper;
    private final RecurringTodoMapper recurringMapper;

    public CatalogReadService(ScheduleService scheduleService, ScheduleMapper scheduleMapper,
                              CourseMapper courseMapper, ExamMapper examMapper, TodoMapper todoMapper,
                              RecurringTodoMapper recurringMapper) {
        this.scheduleService = scheduleService;
        this.scheduleMapper = scheduleMapper;
        this.courseMapper = courseMapper;
        this.examMapper = examMapper;
        this.todoMapper = todoMapper;
        this.recurringMapper = recurringMapper;
    }

    public PageResult<CatalogViews.ScheduleView> schedules(String apiKey, String search, int page, int pageSize) {
        var query = new LambdaQueryWrapper<Schedule>().eq(Schedule::getApiKey, apiKey);
        String term = searchTerm(search);
        if (term != null) query.like(Schedule::getName, term);
        query.orderByDesc(Schedule::getCreatedAt, Schedule::getId);
        return read(scheduleMapper, query, page, pageSize, CatalogViews.ScheduleView::of);
    }

    public PageResult<CatalogViews.CourseView> courses(Long scheduleId, String apiKey, String search,
                                                       Integer dayOfWeek, int page, int pageSize) {
        scheduleService.getById(scheduleId, apiKey);
        var query = new LambdaQueryWrapper<Course>().eq(Course::getScheduleId, scheduleId);
        String term = searchTerm(search);
        if (term != null) query.and(q -> q.like(Course::getName, term)
                .or().like(Course::getTeacher, term).or().like(Course::getLocation, term));
        if (dayOfWeek != null) {
            if (dayOfWeek < 1 || dayOfWeek > 7) throw new BusinessException(400, "星期须在 1 至 7 之间");
            query.eq(Course::getDayOfWeek, dayOfWeek);
        }
        query.orderByAsc(Course::getDayOfWeek, Course::getStartPeriod, Course::getId);
        return read(courseMapper, query, page, pageSize, CatalogViews.CourseView::of);
    }

    public PageResult<CatalogViews.ExamView> exams(Long scheduleId, String apiKey, String search,
                                                   LocalDate from, LocalDate to, int page, int pageSize) {
        scheduleService.getById(scheduleId, apiKey);
        if (from != null && to != null && to.isBefore(from)) {
            throw new BusinessException(400, "结束日期不能早于开始日期");
        }
        var query = new LambdaQueryWrapper<Exam>().eq(Exam::getScheduleId, scheduleId);
        String term = searchTerm(search);
        if (term != null) query.like(Exam::getName, term);
        if (from != null) query.ge(Exam::getExamDate, from);
        if (to != null) query.le(Exam::getExamDate, to);
        query.orderByAsc(Exam::getExamDate, Exam::getStartTime, Exam::getId);
        return read(examMapper, query, page, pageSize, CatalogViews.ExamView::of);
    }

    public PageResult<CatalogViews.TodoView> todos(String apiKey, String search, Boolean completed,
                                                   int page, int pageSize) {
        var query = new LambdaQueryWrapper<Todo>().eq(Todo::getApiKey, apiKey);
        String term = searchTerm(search);
        if (term != null) query.like(Todo::getTitle, term);
        if (completed != null) query.eq(Todo::getCompleted, completed);
        query.orderByAsc(Todo::getDdl, Todo::getId);
        return read(todoMapper, query, page, pageSize, CatalogViews.TodoView::of);
    }

    public PageResult<CatalogViews.RecurringView> recurring(String apiKey, String search, Boolean enabled,
                                                            int page, int pageSize) {
        var query = new LambdaQueryWrapper<RecurringTodo>().eq(RecurringTodo::getApiKey, apiKey);
        String term = searchTerm(search);
        if (term != null) query.like(RecurringTodo::getTitle, term);
        if (enabled != null) query.eq(RecurringTodo::getEnabled, enabled);
        query.orderByAsc(RecurringTodo::getNextTriggerAt, RecurringTodo::getId);
        return read(recurringMapper, query, page, pageSize, CatalogViews.RecurringView::of);
    }

    private String searchTerm(String search) {
        if (search == null || search.isBlank()) return null;
        String trimmed = search.trim();
        if (trimmed.length() > 100) throw new BusinessException(400, "搜索词最多 100 个字符");
        return trimmed;
    }

    private <E, V> PageResult<V> read(BaseMapper<E> mapper, LambdaQueryWrapper<E> query,
                                      int page, int pageSize, Function<E, V> view) {
        if (page < 1 || pageSize < 1 || pageSize > MAX_PAGE_SIZE
                || (long) (page - 1) * pageSize > MAX_OFFSET) {
            throw new BusinessException(400, "分页范围无效：page ≥ 1，pageSize 为 1 至 100，最多跳过 100000 条");
        }
        long total = mapper.selectCount(query);
        int offset = (page - 1) * pageSize;
        query.last("LIMIT " + pageSize + " OFFSET " + offset);
        List<V> items = mapper.selectList(query).stream().map(view).toList();
        return new PageResult<>(items, total, page, pageSize);
    }
}
