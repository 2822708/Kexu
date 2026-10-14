package com.timetable.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 学生档案（AI Campus Agent V1.0）。一个 api_key 一条档案。
 * interest/skills 以 JSON 数组文本存储，由 JacksonTypeHandler 映射为 List&lt;String&gt;。
 */
@TableName(value = "student_profile", autoResultMap = true)
public class StudentProfile {

    public static final String UPDATED_BY_USER = "USER";
    public static final String UPDATED_BY_AI = "AI";

    @TableId(type = IdType.AUTO)
    private Long id;
    private String apiKey;
    private String name;
    private String school;
    private String major;
    private String grade;
    private String goal;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> interest;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> skills;

    private String learningStyle;
    private String updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getApiKey() { return apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getSchool() { return school; }
    public void setSchool(String school) { this.school = school; }

    public String getMajor() { return major; }
    public void setMajor(String major) { this.major = major; }

    public String getGrade() { return grade; }
    public void setGrade(String grade) { this.grade = grade; }

    public String getGoal() { return goal; }
    public void setGoal(String goal) { this.goal = goal; }

    public List<String> getInterest() { return interest; }
    public void setInterest(List<String> interest) { this.interest = interest; }

    public List<String> getSkills() { return skills; }
    public void setSkills(List<String> skills) { this.skills = skills; }

    public String getLearningStyle() { return learningStyle; }
    public void setLearningStyle(String learningStyle) { this.learningStyle = learningStyle; }

    public String getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(String updatedBy) { this.updatedBy = updatedBy; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
