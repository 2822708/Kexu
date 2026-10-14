package com.timetable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 设置页手动新增/编辑长期记忆（AI Campus Agent V1.0 Step 7）。
 * type 与 importance 可空：新增时缺省为 PREFERENCE / 3，编辑时空值表示保持原值。
 */
public class MemoryRequest {

    @Size(max = 20, message = "记忆类型过长")
    private String type;

    @NotBlank(message = "记忆内容不能为空")
    @Size(max = 200, message = "记忆内容过长（最多 200 字）")
    private String content;

    private Integer importance;

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public Integer getImportance() { return importance; }
    public void setImportance(Integer importance) { this.importance = importance; }
}
