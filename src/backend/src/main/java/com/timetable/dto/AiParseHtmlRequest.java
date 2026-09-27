package com.timetable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class AiParseHtmlRequest {
    @NotBlank(message = "HTML 内容不能为空")
    @Size(max = 60000, message = "HTML 内容不能超过 60000 个字符")
    private String html;

    public String getHtml() { return html; }
    public void setHtml(String html) { this.html = html; }
}
