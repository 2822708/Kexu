package com.timetable.service;

import com.timetable.dto.AiContextSummary;
import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.CursorPage;
import com.timetable.dto.TaskExtractRequest;
import com.timetable.dto.TaskExtractResult;
import com.timetable.entity.AiConversation;

import java.util.List;
import java.util.Map;

public interface AiService {

    AiConversation createConversation(AiConversationRequest request, String apiKey);

    AiConversation renameConversation(Long conversationId, String title, String apiKey);

    List<AiConversation> listConversations(String apiKey);

    CursorPage<AiConversation> pageConversations(String cursor, int pageSize, String apiKey);

    void deleteConversation(Long conversationId, String apiKey);

    List<AiMessageResponse> listMessages(Long conversationId, String apiKey);

    /**
     * 上下文注入摘要（AI Campus Agent V1.0 Step 3）。
     *
     * 与聊天 system prompt 的五段式上下文（档案/课表/任务/记忆）同源同算，
     * 供前端在输入框上方展示上下文 chips。纯读查询，不调用模型、不写库。
     */
    AiContextSummary contextSummary(Long conversationId, String apiKey);

    CursorPage<AiMessageResponse> pageMessages(Long conversationId, Long beforeId, int pageSize, String apiKey);

    AiMessageResponse sendMessage(Long conversationId, AiMessageRequest request, String apiKey);

    /**
     * 流式发送消息。阶段事件通过 listener 推送，返回最终落库的完整消息。
     */
    AiMessageResponse sendMessageStream(Long conversationId, AiMessageRequest request,
                                       String apiKey, StreamCallback callback);

    interface StreamCallback {
        /** 思考阶段增量 */
        void onThinking(String delta);

        /** 正文增量 */
        void onText(String delta);

        /** 正文结束，开始解析操作提案 */
        void onPlanning();

        /**
         * 客户端是否已断开。实现方在推送事件失败时置为 true；
         * 服务端据此中断上游调用，避免继续为一个已被遗弃的请求消耗资源与落库。
         */
        default boolean isCancelled() {
            return false;
        }
    }

    AiMessageResponse executeAction(Long conversationId, Long actionId, String apiKey);

    AiMessageResponse rejectAction(Long conversationId, Long actionId, String apiKey);

    /**
     * 当用户手动改动课表/待办后调用，使对应作用域内待确认的 AI 提案失效。
     * scope 为 COURSE 或 TODO，两者互不影响。
     */
    void invalidateProposalsOnDataChange(String apiKey, String scope);
    void invalidateProposalsOnDataChange(String apiKey, String scope, Long scheduleId);

    /**
     * 解析教务系统 HTML，返回 {"courses": [...]} 结构供前端预览。
     */
    Map<String, Object> parseHtml(String html, Long scheduleId, String apiKey);

    /**
     * 从材料（文本或截图）抽取任务草稿（AI Campus Agent V1.0 Step 4）。
     * **不落库**：草稿经用户核对/编辑后由 POST /api/tasks 创建。
     * deadline 无明确时间一律为 null（严禁猜测）；模型输出非法字段在此清洗。
     */
    TaskExtractResult extractTasks(TaskExtractRequest request, String apiKey);

    /** Transcribes one ephemeral image; the image is never persisted by the application. */
    String parseImageText(String imageDataUrl);

    boolean isEnabled();
}
