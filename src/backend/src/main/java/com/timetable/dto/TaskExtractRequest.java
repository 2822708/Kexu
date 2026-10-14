package com.timetable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 任务抽取请求（AI Campus Agent V1.0 Step 4）。
 *
 * 二选一：{@code text}（客户端已提取的材料文本：TXT/MD/CSV/ICS/HTML/PDF 文本层/DOCX）
 * 或 {@code imageDataUrl}（截图，由视觉模型直接识别，省一次 OCR 往返）。
 * 扫描版 PDF 无文本层，由前端引导改传截图。
 */
public class TaskExtractRequest {

    @Size(max = 18000, message = "材料文本过长（最多 18000 字），请拆分后重试")
    private String text;

    /** data:image/...;base64,... 形式，≤4MiB（与既有截图 OCR 上限一致）。 */
    @Size(max = 6_000_000, message = "图片过大（最大约 4 MiB）")
    private String imageDataUrl;

    public String getText() { return text; }
    public void setText(String text) { this.text = text; }

    public String getImageDataUrl() { return imageDataUrl; }
    public void setImageDataUrl(String imageDataUrl) { this.imageDataUrl = imageDataUrl; }
}
