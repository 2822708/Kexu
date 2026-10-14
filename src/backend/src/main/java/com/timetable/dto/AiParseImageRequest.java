package com.timetable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class AiParseImageRequest {
    @NotBlank(message = "图片不能为空")
    @Size(max = 6_000_000, message = "图片太大，请限制在 4 MiB 以内")
    private String imageDataUrl;

    public String getImageDataUrl() { return imageDataUrl; }
    public void setImageDataUrl(String imageDataUrl) { this.imageDataUrl = imageDataUrl; }
}
