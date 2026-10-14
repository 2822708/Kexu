package com.timetable.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.dto.StudentProfilePatch;
import com.timetable.entity.StudentProfile;
import com.timetable.exception.BusinessException;
import com.timetable.mapper.StudentProfileMapper;
import com.timetable.service.StudentProfileService;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
public class StudentProfileServiceImpl implements StudentProfileService {

    private static final int MAX_NAME = 50;
    private static final int MAX_SCHOOL = 100;
    private static final int MAX_MAJOR = 100;
    private static final int MAX_GRADE = 20;
    private static final int MAX_GOAL = 500;
    private static final int MAX_LEARNING_STYLE = 100;
    private static final int MAX_TAGS = 10;
    private static final int MAX_TAG_CHARS = 30;

    /** 允许 AI/表单更新的字段白名单：白名单外的字段一律拒绝，防止越权改写。 */
    private static final Set<String> ALLOWED_FIELDS = Set.of(
            "name", "school", "major", "grade", "goal", "learningStyle", "interest", "skills");

    private final StudentProfileMapper mapper;
    private final ObjectMapper objectMapper;

    public StudentProfileServiceImpl(StudentProfileMapper mapper, ObjectMapper objectMapper) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public StudentProfile find(String apiKey) {
        return mapper.selectOne(new LambdaQueryWrapper<StudentProfile>()
                .eq(StudentProfile::getApiKey, apiKey)
                .last("LIMIT 1"));
    }

    @Override
    public StudentProfile getOrCreate(String apiKey) {
        StudentProfile existing = find(apiKey);
        if (existing != null) {
            return existing;
        }
        StudentProfile created = new StudentProfile();
        created.setApiKey(apiKey);
        created.setInterest(List.of());
        created.setSkills(List.of());
        created.setUpdatedBy(StudentProfile.UPDATED_BY_USER);
        mapper.insert(created);
        return created;
    }

    @Override
    public StudentProfilePatch parse(ObjectNode fields) {
        if (fields == null || fields.isEmpty()) {
            throw new BusinessException(400, "档案更新内容为空");
        }
        for (var it = fields.fieldNames(); it.hasNext(); ) {
            String field = it.next();
            if (!ALLOWED_FIELDS.contains(field)) {
                throw new BusinessException(400, "不支持的档案字段: " + field);
            }
        }
        StudentProfilePatch patch = new StudentProfilePatch();
        patch.setName(textField(fields, "name", MAX_NAME));
        patch.setSchool(textField(fields, "school", MAX_SCHOOL));
        patch.setMajor(textField(fields, "major", MAX_MAJOR));
        patch.setGrade(textField(fields, "grade", MAX_GRADE));
        patch.setGoal(textField(fields, "goal", MAX_GOAL));
        patch.setLearningStyle(textField(fields, "learningStyle", MAX_LEARNING_STYLE));
        patch.setInterest(tagsField(fields, "interest"));
        patch.setSkills(tagsField(fields, "skills"));
        return patch;
    }

    @Override
    public void applyPatch(String apiKey, StudentProfilePatch patch, String updatedBy) {
        StudentProfile profile = getOrCreate(apiKey);
        boolean changed = false;
        if (patch.getName() != null && !patch.getName().equals(profile.getName())) {
            profile.setName(patch.getName());
            changed = true;
        }
        if (patch.getSchool() != null && !patch.getSchool().equals(profile.getSchool())) {
            profile.setSchool(patch.getSchool());
            changed = true;
        }
        if (patch.getMajor() != null && !patch.getMajor().equals(profile.getMajor())) {
            profile.setMajor(patch.getMajor());
            changed = true;
        }
        if (patch.getGrade() != null && !patch.getGrade().equals(profile.getGrade())) {
            profile.setGrade(patch.getGrade());
            changed = true;
        }
        if (patch.getGoal() != null && !patch.getGoal().equals(profile.getGoal())) {
            profile.setGoal(patch.getGoal());
            changed = true;
        }
        if (patch.getLearningStyle() != null && !patch.getLearningStyle().equals(profile.getLearningStyle())) {
            profile.setLearningStyle(patch.getLearningStyle());
            changed = true;
        }
        if (patch.getInterest() != null && !patch.getInterest().equals(profile.getInterest())) {
            profile.setInterest(patch.getInterest());
            changed = true;
        }
        if (patch.getSkills() != null && !patch.getSkills().equals(profile.getSkills())) {
            profile.setSkills(patch.getSkills());
            changed = true;
        }
        if (!changed) {
            return;
        }
        profile.setUpdatedBy(updatedBy);
        profile.setUpdatedAt(LocalDateTime.now());
        mapper.updateById(profile);
    }

    @Override
    public ObjectNode snapshot(StudentProfile profile) {
        ObjectNode node = objectMapper.createObjectNode();
        if (profile == null) {
            return node;
        }
        node.put("name", profile.getName());
        node.put("school", profile.getSchool());
        node.put("major", profile.getMajor());
        node.put("grade", profile.getGrade());
        node.put("goal", profile.getGoal());
        node.put("learningStyle", profile.getLearningStyle());
        node.set("interest", stringArray(profile.getInterest()));
        node.set("skills", stringArray(profile.getSkills()));
        node.put("updatedBy", profile.getUpdatedBy());
        return node;
    }

    private ArrayNode stringArray(List<String> values) {
        ArrayNode array = objectMapper.createArrayNode();
        if (values != null) {
            values.forEach(array::add);
        }
        return array;
    }

    private String textField(ObjectNode fields, String name, int maxChars) {
        JsonNode value = fields.get(name);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw new BusinessException(400, "档案字段 " + name + " 必须是文本");
        }
        String text = value.asText().trim();
        if (text.isEmpty() || "null".equals(text)) {
            return null;
        }
        if (text.length() > maxChars) {
            throw new BusinessException(400, "档案字段 " + name + " 过长（最多 " + maxChars + " 字）");
        }
        return text;
    }

    private List<String> tagsField(ObjectNode fields, String name) {
        JsonNode value = fields.get(name);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isArray()) {
            throw new BusinessException(400, "档案字段 " + name + " 必须是数组");
        }
        Set<String> tags = new LinkedHashSet<>();
        for (JsonNode item : value) {
            if (!item.isTextual()) {
                throw new BusinessException(400, "档案字段 " + name + " 只能包含文本");
            }
            String tag = item.asText().trim();
            if (tag.isEmpty()) {
                continue;
            }
            if (tag.length() > MAX_TAG_CHARS) {
                throw new BusinessException(400, "档案字段 " + name + " 的条目过长（最多 " + MAX_TAG_CHARS + " 字）");
            }
            tags.add(tag);
            if (tags.size() > MAX_TAGS) {
                throw new BusinessException(400, "档案字段 " + name + " 条目过多（最多 " + MAX_TAGS + " 个）");
            }
        }
        return new ArrayList<>(tags);
    }
}
