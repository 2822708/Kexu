package com.timetable.service;

import com.timetable.dto.StudentProfilePatch;
import com.timetable.entity.StudentProfile;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 学生档案（AI Campus Agent V1.0）。一个 api_key 一条档案。
 */
public interface StudentProfileService {

    /** 查询档案；不存在返回 null（只读路径使用，不产生副作用）。 */
    StudentProfile find(String apiKey);

    /** 查询档案，不存在则创建空档案。 */
    StudentProfile getOrCreate(String apiKey);

    /**
     * 把 AI/用户提交的 JSON 字段解析为补丁并校验（白名单、类型、长度）。
     * 非法输入抛 BusinessException(400)。
     */
    StudentProfilePatch parse(ObjectNode fields);

    /** 应用补丁。updatedBy 标记来源（USER 设置页 / AI 提案执行）。 */
    void applyPatch(String apiKey, StudentProfilePatch patch, String updatedBy);

    /** 档案全量快照（用于 UPDATE_PROFILE 提案的 _before 反向数据）。 */
    ObjectNode snapshot(StudentProfile profile);
}
