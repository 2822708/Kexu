package com.timetable.dto;

import java.util.List;

/**
 * 学生档案局部更新（AI Campus Agent V1.0）。
 *
 * 所有字段可空：只有非空字段会被应用。AI 提案（UPDATE_PROFILE）与设置页表单
 * 共用本结构；字段白名单与长度限制由 StudentProfileServiceImpl 统一校验。
 */
public class StudentProfilePatch {

    private String name;
    private String school;
    private String major;
    private String grade;
    private String goal;
    private String learningStyle;
    private List<String> interest;
    private List<String> skills;

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

    public String getLearningStyle() { return learningStyle; }
    public void setLearningStyle(String learningStyle) { this.learningStyle = learningStyle; }

    public List<String> getInterest() { return interest; }
    public void setInterest(List<String> interest) { this.interest = interest; }

    public List<String> getSkills() { return skills; }
    public void setSkills(List<String> skills) { this.skills = skills; }
}
