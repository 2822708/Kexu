package com.timetable.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/** 通知卡片批量落库请求（草稿确认后的结果）。 */
public class NoticeCreateRequest {

    @NotEmpty(message = "通知列表不能为空")
    @Size(max = 10, message = "一次最多创建 10 条通知")
    private List<@Valid NoticeDraft> cards;

    public List<NoticeDraft> getCards() { return cards; }
    public void setCards(List<NoticeDraft> cards) { this.cards = cards; }
}
