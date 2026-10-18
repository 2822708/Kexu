package com.timetable.service;

import com.timetable.dto.NoticeDraft;
import com.timetable.dto.NoticeExtractResult;
import com.timetable.entity.NoticeCard;

import java.util.List;

/**
 * 今日待阅通知箱。
 *
 * <p><b>信息入口是手动喂入</b>：用户把群公告、教务邮件、截图转发或粘贴给助手，
 * AI 提炼成精简卡片。没有自动抓取——那需要监听群消息或爬教务系统，
 * 既不可靠也有合规风险。
 */
public interface NoticeService {

    /**
     * AI 提炼草稿，**不落库**（human-in-the-loop）。
     *
     * <p>只接受文本。截图路径由前端先调 {@code POST /api/ai/parse-image} 转成文本再进来，
     * 这样既复用了既有的图片校验与并发闸门，也让 OCR 成本落在它自己的埋点场景里。
     */
    NoticeExtractResult extract(String text, String apiKey);

    /** 草稿确认后批量落库。 */
    List<NoticeCard> create(String apiKey, List<NoticeDraft> drafts);

    /** 今日待阅：待决定且「稍后提醒」已到期的卡片；被高频忽略的来源排在后面。 */
    List<NoticeCard> listToday(String apiKey);

    /**
     * 最近 N 条卡片（**全状态**，按创建时间倒序）——信息处理页底部预览栏用。
     *
     * <p>与 {@link #listToday} 的区别：这里要能看出「哪些已加入日程、哪些被忽略」，
     * 所以不过滤状态；limit 由调用方夹到 [1, 20]。
     */
    List<NoticeCard> listRecent(String apiKey, int limit);

    /** 加入日程：卡片转任务。返回的 task 由调用方决定怎么展示。 */
    NoticeCard toTask(Long id, String apiKey, com.timetable.dto.TaskDraft draft);

    /** 忽略：保留数据便于追溯，只是不再出现在待阅列表。 */
    NoticeCard ignore(Long id, String apiKey);

    /** 稍后提醒：卡片暂时移出待阅列表，到点自动回来。 */
    NoticeCard snooze(Long id, String apiKey, int hours);

    NoticeCard remove(Long id, String apiKey);
}
