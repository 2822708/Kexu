package com.timetable.dto;

import jakarta.validation.constraints.Size;

/**
 * 通知提炼请求。**只接受文本**——截图由前端先走 {@code POST /api/ai/parse-image}
 * 转成文本再进来，这样复用既有的图片校验与并发闸门，OCR 成本也落在它自己的埋点场景上。
 */
public class NoticeExtractRequest {

    @Size(max = 18000, message = "材料文本过长（最多 18000 字），请拆分后重试")
    private String text;

    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
}
