package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.timetable.dto.TodoRequest;
import com.timetable.entity.Todo;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.TodoMapper;
import com.timetable.service.TodoService;
import com.timetable.service.RecurringTodoService;
import com.timetable.service.RequestValidationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class TodoServiceImpl implements TodoService {

    private final TodoMapper todoMapper;
    private final RecurringTodoService recurringTodoService;
    private final RequestValidationService requestValidation;

    public TodoServiceImpl(TodoMapper todoMapper, RecurringTodoService recurringTodoService,
                           RequestValidationService requestValidation) {
        this.todoMapper = todoMapper;
        this.recurringTodoService = recurringTodoService;
        this.requestValidation = requestValidation;
    }

    @Override
    public List<Todo> list(String apiKey) {
        LambdaQueryWrapper<Todo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Todo::getApiKey, apiKey).orderByAsc(Todo::getDdl);
        return todoMapper.selectList(wrapper);
    }

    @Override
    public Todo getById(Long id, String apiKey) {
        Todo todo = todoMapper.selectById(id);
        if (todo == null || !apiKey.equals(todo.getApiKey())) {
            throw new BusinessException(404, "待办不存在");
        }
        return todo;
    }

    @Override
    public Todo create(TodoRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Todo todo = new Todo();
        todo.setApiKey(apiKey);
        todo.setTitle(request.getTitle());
        todo.setDdl(request.getDdl());
        todo.setCompleted(false);
        todo.setChainGenerated(false);
        todoMapper.insert(todo);
        return todo;
    }

    @Override
    public Todo update(Long id, TodoRequest request, String apiKey) {
        requestValidation.requireValid(request);
        Todo todo = todoMapper.selectById(id);
        if (todo == null || !todo.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "待办不存在");
        }
        todo.setTitle(request.getTitle());
        todo.setDdl(request.getDdl());
        todoMapper.updateById(todo);
        return todo;
    }

    @Override
    public void delete(Long id, String apiKey) {
        Todo todo = todoMapper.selectById(id);
        if (todo == null || !todo.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "待办不存在");
        }
        todoMapper.deleteById(id);
    }

    @Override
    @Transactional
    public Todo toggleComplete(Long id, String apiKey) {
        Todo todo = todoMapper.selectById(id);
        if (todo == null || !todo.getApiKey().equals(apiKey)) {
            throw new BusinessException(404, "待办不存在");
        }
        boolean completed = Boolean.TRUE.equals(todo.getCompleted());
        boolean next = !completed;
        boolean spawnNext = next && todo.getRecurringId() != null
                && !Boolean.TRUE.equals(todo.getChainGenerated());
        var update = Wrappers.<Todo>lambdaUpdate()
                .eq(Todo::getId, id)
                .eq(Todo::getApiKey, apiKey)
                .eq(Todo::getCompleted, completed)
                .set(Todo::getCompleted, next);
        if (spawnNext) {
            update.eq(Todo::getChainGenerated, false)
                    .set(Todo::getChainGenerated, true);
        }
        int updated = todoMapper.update(null, update);
        if (updated != 1) {
            throw new BusinessException(409, "待办状态已被其它请求修改，请刷新后重试");
        }
        todo.setCompleted(next);
        if (spawnNext) {
            recurringTodoService.onTodoCompleted(todo.getRecurringId(), apiKey);
        }
        return todo;
    }

    @Override
    public Todo createForExam(Long examId, String title, java.time.LocalDateTime ddl, String apiKey) {
        Todo todo = new Todo();
        todo.setApiKey(apiKey);
        todo.setTitle(title);
        todo.setDdl(ddl);
        todo.setCompleted(false);
        todo.setChainGenerated(false);
        todo.setExamId(examId);
        todoMapper.insert(todo);
        return todo;
    }

    @Override
    public void updateExamLinked(Long examId, String title, java.time.LocalDateTime ddl, String apiKey) {
        LambdaQueryWrapper<Todo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Todo::getExamId, examId).eq(Todo::getApiKey, apiKey);
        for (Todo todo : todoMapper.selectList(wrapper)) {
            todo.setTitle(title);
            todo.setDdl(ddl);
            todoMapper.updateById(todo);
        }
    }

    @Override
    public void deleteByExamId(Long examId, String apiKey) {
        LambdaQueryWrapper<Todo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Todo::getExamId, examId).eq(Todo::getApiKey, apiKey);
        todoMapper.delete(wrapper);
    }

    @Override
    public void completeByExamId(Long examId) {
        LambdaQueryWrapper<Todo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Todo::getExamId, examId).eq(Todo::getCompleted, false);
        for (Todo todo : todoMapper.selectList(wrapper)) {
            todo.setCompleted(true);
            todoMapper.updateById(todo);
        }
    }
}
