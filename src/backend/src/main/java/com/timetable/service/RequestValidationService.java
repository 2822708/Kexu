package com.timetable.service;

import com.timetable.exception.BusinessException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.Set;

/** Apply the same request constraints to REST, AI and background business paths. */
@Service
public class RequestValidationService {

    private final Validator validator;

    public RequestValidationService(Validator validator) {
        this.validator = validator;
    }

    public <T> T requireValid(T request) {
        if (request == null) {
            throw new BusinessException(400, "请求内容不能为空");
        }
        Set<ConstraintViolation<T>> violations = validator.validate(request);
        violations.stream()
                .min(Comparator.comparing(v -> v.getPropertyPath().toString()))
                .ifPresent(v -> {
                    throw new BusinessException(400,
                            v.getPropertyPath() + ": " + v.getMessage());
                });
        return request;
    }
}
