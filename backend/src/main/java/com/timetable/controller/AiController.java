package com.timetable.controller;

import com.timetable.dto.AiConversationRequest;
import com.timetable.dto.AiMessageRequest;
import com.timetable.dto.AiMessageResponse;
import com.timetable.dto.AiParseHtmlRequest;
import com.timetable.dto.AiRenameRequest;
import com.timetable.dto.ApiResponse;
import com.timetable.entity.AiConversation;
import com.timetable.exception.BusinessException;
import com.timetable.interceptor.RequestContext;
import com.timetable.service.AiService;
import jakarta.annotation.PreDestroy;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private static final Logger log = LoggerFactory.getLogger(AiController.class);
    private static final long STREAM_TIMEOUT_MS = 300_000L;
    private static final AtomicInteger STREAM_THREAD_SEQ = new AtomicInteger();

    private final AiService aiService;

    /**
     * 流式任务执行器。
     *
     * 线程数等于最大并发：ThreadPoolExecutor 只在核心线程忙、且队列也满时才创建更多线程，
     * 所以「core=4 / max=16」实际并发上限就是 4，第 5 个请求会静默排队而不发任何事件。
     * 这里把 core 与 max 都设为配置值，队列只作为短时缓冲，队列满即按 AbortPolicy 拒绝并回
     * 503，客户端能立刻得到明确反馈。
     */
    private final ExecutorService streamExecutor;

    public AiController(AiService aiService,
                        @Value("${app.ai.stream.max-concurrency:16}") int maxConcurrency,
                        @Value("${app.ai.stream.queue-capacity:64}") int queueCapacity) {
        this.aiService = aiService;
        int concurrency = Math.max(1, maxConcurrency);
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                concurrency, concurrency, 60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(Math.max(1, queueCapacity)),
                r -> {
                    Thread t = new Thread(r, "ai-stream-" + STREAM_THREAD_SEQ.incrementAndGet());
                    t.setDaemon(true);
                    return t;
                },
                new ThreadPoolExecutor.AbortPolicy());
        executor.allowCoreThreadTimeOut(true);
        this.streamExecutor = executor;
    }

    @PreDestroy
    public void shutdownStreamExecutor() {
        streamExecutor.shutdown();
    }

    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> status() {
        Map<String, Object> data = new HashMap<>();
        data.put("enabled", aiService.isEnabled());
        return ApiResponse.success(data);
    }

    @GetMapping("/conversations")
    public ApiResponse<List<AiConversation>> listConversations() {
        return ApiResponse.success(aiService.listConversations(RequestContext.getApiKey()));
    }

    @PostMapping("/conversations")
    public ApiResponse<AiConversation> createConversation(@RequestBody(required = false) AiConversationRequest request) {
        return ApiResponse.success(aiService.createConversation(request, RequestContext.getApiKey()));
    }

    @PutMapping("/conversations/{id}")
    public ApiResponse<AiConversation> renameConversation(@PathVariable Long id,
                                                         @Valid @RequestBody AiRenameRequest request) {
        return ApiResponse.success(
                aiService.renameConversation(id, request.getTitle(), RequestContext.getApiKey()));
    }

    @DeleteMapping("/conversations/{id}")
    public ApiResponse<Void> deleteConversation(@PathVariable Long id) {
        aiService.deleteConversation(id, RequestContext.getApiKey());
        return ApiResponse.success(null);
    }

    @GetMapping("/conversations/{id}/messages")
    public ApiResponse<List<AiMessageResponse>> listMessages(@PathVariable Long id) {
        return ApiResponse.success(aiService.listMessages(id, RequestContext.getApiKey()));
    }

    @PostMapping("/conversations/{id}/messages")
    public ApiResponse<AiMessageResponse> sendMessage(@PathVariable Long id,
                                                      @Valid @RequestBody AiMessageRequest request) {
        return ApiResponse.success(aiService.sendMessage(id, request, RequestContext.getApiKey()));
    }

    /**
     * 流式发送消息。事件序列：thinking* → text* → planning → done，出错时为 error。
     */
    @PostMapping(value = "/conversations/{id}/messages/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter sendMessageStream(@PathVariable Long id,
                                        @Valid @RequestBody AiMessageRequest request) {
        String apiKey = RequestContext.getApiKey();
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        // 客户端断开（完成/超时/出错）后置位，用于中断上游调用：
        // 否则工作线程会一直读到上游结束，白占并发额度，并把用户看不到的回复落库
        AtomicBoolean cancelled = new AtomicBoolean(false);
        emitter.onCompletion(() -> cancelled.set(true));
        emitter.onTimeout(() -> cancelled.set(true));
        emitter.onError(e -> cancelled.set(true));

        try {
            streamExecutor.execute(() -> {
            try {
                AiMessageResponse result = aiService.sendMessageStream(id, request, apiKey,
                        new AiService.StreamCallback() {
                            @Override
                            public void onThinking(String delta) {
                                emit(emitter, "thinking", Map.of("delta", delta), cancelled);
                            }

                            @Override
                            public void onText(String delta) {
                                emit(emitter, "text", Map.of("delta", delta), cancelled);
                            }

                            @Override
                            public void onPlanning() {
                                emit(emitter, "planning", Map.of(), cancelled);
                            }

                            @Override
                            public boolean isCancelled() {
                                return cancelled.get();
                            }
                        });
                emit(emitter, "done", result, cancelled);
                emitter.complete();
            } catch (BusinessException e) {
                emit(emitter, "error", Map.of("code", e.getCode(), "message", e.getMessage()), cancelled);
                emitter.complete();
            } catch (Exception e) {
                log.error("AI stream failed", e);
                emit(emitter, "error", Map.of("code", 500, "message", "AI 服务异常"), cancelled);
                emitter.complete();
            }
            });
        } catch (RejectedExecutionException e) {
            log.warn("AI stream rejected: executor saturated");
            emit(emitter, "error", Map.of("code", 503, "message", "当前 AI 请求过多，请稍后重试"), cancelled);
            emitter.complete();
        }

        return emitter;
    }

    /**
     * 推送一个 SSE 事件。客户端已断开时不可能送达，此时置位 cancelled 并放弃，
     * 让上游读取循环尽快退出。
     */
    private void emit(SseEmitter emitter, String event, Object data, AtomicBoolean cancelled) {
        if (cancelled.get()) {
            return;
        }
        try {
            emitter.send(SseEmitter.event().name(event).data(data, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
            // 客户端已断开：标记取消，由上游据此中断请求
            cancelled.set(true);
        }
    }

    @PostMapping("/conversations/{id}/actions/{actionId}/execute")
    public ApiResponse<AiMessageResponse> execute(@PathVariable Long id, @PathVariable Long actionId) {
        return ApiResponse.success(aiService.executeAction(id, actionId, RequestContext.getApiKey()));
    }

    @PostMapping("/conversations/{id}/actions/{actionId}/reject")
    public ApiResponse<AiMessageResponse> reject(@PathVariable Long id, @PathVariable Long actionId) {
        return ApiResponse.success(aiService.rejectAction(id, actionId, RequestContext.getApiKey()));
    }

    @PostMapping("/parse-html")
    public ApiResponse<Map<String, Object>> parseHtml(@Valid @RequestBody AiParseHtmlRequest request,
                                                     @RequestParam(required = false) Long scheduleId) {
        return ApiResponse.success(aiService.parseHtml(request.getHtml(), scheduleId, RequestContext.getApiKey()));
    }
}
