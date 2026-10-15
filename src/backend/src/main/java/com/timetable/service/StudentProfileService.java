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

    /**
     * 全量覆盖（设置页表单语义）：补丁里为 null 的字段会被清空。
     *
     * 与 {@link #applyPatch} 的区别在于 null 的含义——AI 提案里「null=没提到，保持原值」
     * 才是对的，而表单里「输入框清空了」就是要删掉。两条路径分开，互不污染。
     */
    StudentProfile replace(String apiKey, StudentProfilePatch patch);

    /** 档案全量快照（用于 UPDATE_PROFILE 提案的 _before 反向数据）。 */
    ObjectNode snapshot(StudentProfile profile);
}
