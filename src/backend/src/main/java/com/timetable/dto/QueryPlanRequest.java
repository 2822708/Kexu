package com.timetable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 查询计划请求（信息处理页 · AI 主动查询中心）。
 *
 * <p><b>不检索任何外部渠道</b>：没有爬虫、没有对接教务系统——那既不可靠也有合规风险。
 * 这里做的是把用户的查询意图整理成结构化计划：去哪查、查什么、关键节点怎么排、
 * 要盯什么。具体动态由用户按图索骥自己去查，AI 只当「整理员」不当「侦察兵」。
 */
public class QueryPlanRequest {

    /** 分类：COMPETITION / RECRUIT / ACADEMIC / LECTURE */
    @NotBlank(message = "请选择查询分类")
    @Pattern(regexp = "COMPETITION|RECRUIT|ACADEMIC|LECTURE", message = "不支持的查询分类")
    private String category;

    @NotBlank(message = "请输入要查询的关键词")
    @Size(max = 100, message = "关键词过长（最多 100 字）")
    private String keyword;

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getKeyword() { return keyword; }
    public void setKeyword(String keyword) { this.keyword = keyword; }
}
