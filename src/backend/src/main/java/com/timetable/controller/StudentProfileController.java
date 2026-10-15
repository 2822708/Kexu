package com.timetable.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.dto.ApiResponse;
import com.timetable.entity.StudentProfile;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.StudentProfileService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 学生档案（AI Campus Agent V1.0）。
 *
 * <p>档案是五段式上下文的第一段。此前只有 AI 提案（UPDATE_PROFILE）能写入，
 * 用户无法主动填写——首页的「去填写档案」引导指向设置页却没有落点。
 * 本端点补上手动维护路径，与 AI 提案共用同一套字段白名单与校验；
 * 手动填写标 UPDATED_BY_USER，AI 改写标 UPDATED_BY_AI，来源在档案里可区分。
 */
@RestController
@RequestMapping("/api/profile")
public class StudentProfileController {

    private final StudentProfileService profileService;
    private final ObjectMapper objectMapper;

    public StudentProfileController(StudentProfileService profileService, ObjectMapper objectMapper) {
        this.profileService = profileService;
        this.objectMapper = objectMapper;
    }

    /** 当前档案；未建档返回 null（前端据此渲染空表单）。 */
    @GetMapping
    public ApiResponse<StudentProfile> get() {
        return ApiResponse.success(profileService.find(RequestContext.getApiKey()));
    }

    /**
     * 保存档案（表单语义＝全量覆盖）。字段白名单、类型与长度由
     * {@link StudentProfileService#parse} 统一校验，非法输入抛 400；
     * 表单里清空的字段会被真正删掉（AI 提案走的则是「null=保持原值」的补丁语义）。
     */
    @PutMapping
    public ApiResponse<StudentProfile> update(@RequestBody(required = false) ObjectNode fields) {
        return ApiResponse.success(profileService.replace(RequestContext.getApiKey(),
                profileService.parse(fields == null ? objectMapper.createObjectNode() : fields)));
    }
}
