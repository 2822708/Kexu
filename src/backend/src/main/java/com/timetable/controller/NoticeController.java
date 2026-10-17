package com.timetable.controller;

import com.timetable.dto.ApiResponse;
import com.timetable.dto.NoticeCreateRequest;
import com.timetable.dto.NoticeExtractRequest;
import com.timetable.dto.NoticeExtractResult;
import com.timetable.dto.TaskDraft;
import com.timetable.entity.NoticeCard;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.NoticeService;
import com.timetable.service.impl.AiServiceImpl;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 今日待阅通知箱（AI Campus Agent · 手动喂入的信息入口）。
 *
 * <p>信息进来只有一条路：<b>用户主动转发或粘贴</b>。没有群消息监听、没有教务系统抓取——
 * 那些既不可靠也有合规风险，而且会把「学生自己决定看什么」变成「机器替他决定」。
 *
 * <p>流程是 human-in-the-loop：提炼出草稿不落库，用户核对后才写表；
 * 卡片上的「加入日程 / 忽略 / 稍后提醒」三个动作都由用户发起。
 */
@RestController
@RequestMapping("/api/notices")
public class NoticeController {

    private final NoticeService noticeService;
    private final AiServiceImpl aiService;

    public NoticeController(NoticeService noticeService, AiServiceImpl aiService) {
        this.noticeService = noticeService;
        this.aiService = aiService;
    }

    /** 今日待阅：待决定且「稍后提醒」已到期的卡片。 */
    @GetMapping
    public ApiResponse<List<NoticeCard>> list() {
        return ApiResponse.success(noticeService.listToday(RequestContext.getApiKey()));
    }

    /** AI 提炼草稿，不落库。 */
    @PostMapping("/extract")
    public ApiResponse<NoticeExtractResult> extract(@Valid @RequestBody NoticeExtractRequest request) {
        return ApiResponse.success(noticeService.extract(request.getText(), RequestContext.getApiKey()));
    }

    /** 草稿确认后落库。 */
    @PostMapping
    public ApiResponse<List<NoticeCard>> create(@Valid @RequestBody NoticeCreateRequest request) {
        return ApiResponse.success(noticeService.create(RequestContext.getApiKey(), request.getCards()));
    }

    /**
     * 加入日程：卡片转任务。
     *
     * <p>body 可传草稿（用户在弹窗里改过的标题/时间），不传就用卡片内容兜底。
     * 转成功后要让既有的 AI 提案失效——任务列表变了，旧提案的指纹不再可信。
     */
    @PostMapping("/{id}/to-task")
    public ApiResponse<NoticeCard> toTask(@PathVariable Long id, @RequestBody(required = false) TaskDraft draft) {
        String apiKey = RequestContext.getApiKey();
        NoticeCard card = noticeService.toTask(id, apiKey, draft);
        aiService.invalidateProposalsOnDataChange(apiKey, AiServiceImpl.SCOPE_TASK);
        return ApiResponse.success(card);
    }

    /** 忽略：保留数据便于追溯，只是不再出现在待阅列表，并影响同来源的排序。 */
    @PostMapping("/{id}/ignore")
    public ApiResponse<NoticeCard> ignore(@PathVariable Long id) {
        return ApiResponse.success(noticeService.ignore(id, RequestContext.getApiKey()));
    }

    /** 稍后提醒：hours 缺省 4 小时，范围 1–72 小时。 */
    @PostMapping("/{id}/snooze")
    public ApiResponse<NoticeCard> snooze(@PathVariable Long id,
                                          @RequestBody(required = false) Map<String, Object> body) {
        int hours = 4;
        if (body != null && body.get("hours") instanceof Number number) {
            hours = number.intValue();
        }
        return ApiResponse.success(noticeService.snooze(id, RequestContext.getApiKey(), hours));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Boolean> remove(@PathVariable Long id) {
        noticeService.remove(id, RequestContext.getApiKey());
        return ApiResponse.success(true);
    }
}
