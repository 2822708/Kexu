package com.timetable.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 通知提取结果。**不落库**：草稿经用户核对后由 POST /api/notices 创建。
 *
 * <p>与 {@link TaskExtractResult} 同构（cards / confidence / note），
 * 前端的草稿确认弹窗可以照同一套模式写。
 */
public class NoticeExtractResult {

    private List<NoticeDraft> cards = new ArrayList<>();
    private double confidence;
    private String note;

    public List<NoticeDraft> getCards() { return cards; }
    public void setCards(List<NoticeDraft> cards) { this.cards = cards == null ? new ArrayList<>() : cards; }

    public double getConfidence() { return confidence; }
    public void setConfidence(double confidence) { this.confidence = confidence; }

    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
