package com.timetable.service.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.config.DeepSeekProperties;
import com.timetable.exception.BusinessException;
import com.timetable.service.DeepSeekClient;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

@Service
public class DeepSeekClientImpl implements DeepSeekClient {

    private static final Logger log = LoggerFactory.getLogger(DeepSeekClientImpl.class);
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

    private final DeepSeekProperties properties;
    private final DeepSeekKeyStore keyStore;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final ScheduledExecutorService requestWatchdog = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "deepseek-request-watchdog");
        thread.setDaemon(true);
        return thread;
    });

    public DeepSeekClientImpl(DeepSeekProperties properties, DeepSeekKeyStore keyStore,
                              ObjectMapper objectMapper) {
        this.properties = properties;
        this.keyStore = keyStore;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .build();
    }

    @Override
    public boolean isConfigured() {
        return keyStore.isConfigured();
    }

    @PreDestroy
    public void shutdownWatchdog() {
        requestWatchdog.shutdownNow();
    }

    @Override
    public String chatJson(List<Message> messages) {
        return execute(messages, null, () -> false);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener) {
        return execute(messages, listener, () -> false);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener,
                                 java.util.function.BooleanSupplier cancelled) {
        return execute(messages, listener, cancelled);
    }

    private ObjectNode buildBody(List<Message> messages, boolean stream) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", properties.getModel());
        body.put("temperature", 0.2);
        ArrayNode arr = body.putArray("messages");
        for (Message m : messages) {
            ObjectNode node = arr.addObject();
            node.put("role", m.getRole());
            if (m.getImageDataUrl() == null) {
                node.put("content", m.getContent());
            } else {
                if (!"user".equals(m.getRole())) {
                    throw new IllegalArgumentException("Image input is only allowed in user messages");
                }
                ArrayNode parts = node.putArray("content");
                parts.addObject().put("type", "text").put("text", m.getContent());
                ObjectNode image = parts.addObject().put("type", "image_url").putObject("image_url");
                image.put("url", m.getImageDataUrl());
                image.put("detail", "high");
            }
        }
        body.putObject("response_format").put("type", "json_object");
        body.put("max_tokens", properties.getMaxTokens());
        if (properties.getReasoningEffort() != null && !properties.getReasoningEffort().isBlank()) {
            body.put("reasoning_effort", properties.getReasoningEffort());
        }
        if (stream) {
            body.put("stream", true);
        }
        return body;
    }

    private String execute(List<Message> messages, StreamListener listener,
                           BooleanSupplier cancelled) {
        if (!isConfigured()) {
            throw new BusinessException(503, "未配置 DeepSeek API Key，AI 功能不可用");
        }
        boolean stream = listener != null;
        ObjectNode body = buildBody(messages, stream);

        try {
            if (cancelled.getAsBoolean()) {
                throw new BusinessException(499, "客户端已断开，未发起 AI 请求");
            }
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(properties.getBaseUrl().replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofSeconds(Math.max(1, properties.getTimeoutSeconds())))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + keyStore.effectiveKey())
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body), StandardCharsets.UTF_8))
                    .build();

            CompletableFuture<HttpResponse<InputStream>> pending =
                    httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
            try (CallGuard guard = new CallGuard(pending, cancelled,
                    Math.max(1, properties.getTimeoutSeconds()),
                    Math.max(1, properties.getIdleTimeoutSeconds()))) {
                try {
                    HttpResponse<InputStream> response = guard.awaitResponse();
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        try (InputStream errorBody = guard.boundedBody()) {
                            errorBody.readNBytes(4096);
                        }
                        log.warn("DeepSeek API returned HTTP {}", response.statusCode());
                        throw new BusinessException(502, "AI 服务调用失败: HTTP " + response.statusCode());
                    }
                    String result = stream
                            ? readStream(guard, listener)
                            : readJsonResponse(guard);
                    guard.check();
                    return result;
                } catch (Exception failure) {
                    guard.check();
                    throw failure;
                }
            }
        } catch (BusinessException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException(502, "AI 服务调用被中断");
        } catch (ExecutionException e) {
            log.warn("DeepSeek API request failed: {}", e.getCause().getClass().getSimpleName());
            throw new BusinessException(502, "AI 服务调用失败，请重试");
        } catch (Exception e) {
            log.warn("DeepSeek API request failed: {}", e.getClass().getSimpleName());
            throw new BusinessException(502, "AI 服务调用失败，请重试");
        }
    }

    private String readJsonResponse(CallGuard guard) throws IOException {
        byte[] body;
        try (InputStream stream = guard.boundedBody()) {
            body = stream.readAllBytes();
        }
        guard.check();
        JsonNode root;
        try {
            root = objectMapper.readTree(body);
        } catch (Exception malformed) {
            throw new BusinessException(502, "AI 服务返回内容格式有误");
        }
        JsonNode choice = root.path("choices").path(0);
        String finishReason = choice.path("finish_reason").asText();
        if ("length".equals(finishReason)) {
            throw new BusinessException(502, "AI 回复达到长度上限，未保存不完整的操作建议");
        }
        if (!"stop".equals(finishReason)) {
            throw new BusinessException(502, "AI 回复未正常结束，回复未保存");
        }
        JsonNode content = choice.path("message").path("content");
        if (!content.isTextual() || content.asText().isBlank()) {
            throw new BusinessException(502, "AI 服务返回内容为空");
        }
        return content.asText();
    }

    private String readStream(CallGuard guard, StreamListener listener) throws IOException {
            StringBuilder full = new StringBuilder();
            String finishReason = null;
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(guard.boundedBody(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    guard.check();
                    if (!line.startsWith("data:")) {
                        continue;
                    }
                    String payload = line.substring(5).trim();
                    if (payload.isEmpty() || "[DONE]".equals(payload)) {
                        continue;
                    }
                    JsonNode chunk;
                    try {
                        chunk = objectMapper.readTree(payload);
                    } catch (Exception e) {
                        throw new BusinessException(502, "AI 流式数据格式有误，回复未保存");
                    }
                    JsonNode choice = chunk.path("choices").path(0);
                    JsonNode delta = choice.path("delta");
                    JsonNode reasoning = delta.path("reasoning_content");
                    if (reasoning.isTextual() && !reasoning.asText().isEmpty()) {
                        listener.onReasoning(reasoning.asText());
                    }
                    JsonNode content = delta.path("content");
                    if (content.isTextual() && !content.asText().isEmpty()) {
                        full.append(content.asText());
                        listener.onContent(content.asText());
                    }
                    if (choice.path("finish_reason").isTextual()) {
                        finishReason = choice.path("finish_reason").asText();
                    }
                }
            }
            guard.check();
            if ("length".equals(finishReason)) {
                throw new BusinessException(502,
                        "AI 回复达到长度上限，未保存不完整的操作建议，请缩小请求范围后重试");
            }
            if (full.length() == 0) {
                log.error("DeepSeek returned no content, finish_reason={}", finishReason);
                throw new BusinessException(502, "AI 服务返回内容为空，请重试");
            }
            if (!"stop".equals(finishReason)) {
                throw new BusinessException(502, "AI 流式回复未正常结束，回复未保存");
            }
            return full.toString();
    }

    /** The async response is closed even while the caller is blocked inside readLine(). */
    private final class CallGuard implements AutoCloseable {
        private final CompletableFuture<HttpResponse<InputStream>> pending;
        private final BooleanSupplier cancelled;
        private final long startedAt = System.nanoTime();
        private final long totalNanos;
        private final long idleNanos;
        private final AtomicReference<BusinessException> aborted = new AtomicReference<>();
        private final AtomicReference<InputStream> body = new AtomicReference<>();
        private final ScheduledFuture<?> watcher;
        private volatile long lastReadAt = 0;

        private CallGuard(CompletableFuture<HttpResponse<InputStream>> pending, BooleanSupplier cancelled,
                          int totalSeconds, int idleSeconds) {
            this.pending = pending;
            this.cancelled = cancelled;
            this.totalNanos = TimeUnit.SECONDS.toNanos(totalSeconds);
            this.idleNanos = TimeUnit.SECONDS.toNanos(idleSeconds);
            this.watcher = requestWatchdog.scheduleAtFixedRate(this::checkTimeouts,
                    100, 100, TimeUnit.MILLISECONDS);
        }

        private void checkTimeouts() {
            long now = System.nanoTime();
            if (cancelled.getAsBoolean()) {
                abort(new BusinessException(499, "客户端已断开，已停止本次请求"));
            } else if (now - startedAt > totalNanos) {
                abort(new BusinessException(504, "AI 请求超时，请缩小范围后重试"));
            } else if (lastReadAt != 0 && now - lastReadAt > idleNanos) {
                abort(new BusinessException(504, "AI 长时间没有返回数据，请重试"));
            }
        }

        private void abort(BusinessException reason) {
            if (aborted.compareAndSet(null, reason)) {
                pending.cancel(true);
                InputStream current = body.get();
                if (current != null) {
                    try { current.close(); } catch (IOException ignored) { /* already cancelled */ }
                }
            }
        }

        private HttpResponse<InputStream> awaitResponse() throws InterruptedException, ExecutionException {
            HttpResponse<InputStream> response = pending.get();
            body.set(response.body());
            lastReadAt = System.nanoTime();
            check();
            return response;
        }

        private InputStream boundedBody() {
            InputStream current = body.get();
            if (current == null) throw new IllegalStateException("AI response body unavailable");
            return new FilterInputStream(current) {
                private int bytes;
                @Override public int read() throws IOException {
                    int value = super.read();
                    if (value != -1) { record(1); }
                    return value;
                }
                @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                    int count = super.read(buffer, offset, length);
                    if (count > 0) { record(count); }
                    return count;
                }
                private void record(int count) throws IOException {
                    bytes += count;
                    lastReadAt = System.nanoTime();
                    if (bytes > MAX_RESPONSE_BYTES) {
                        throw new IOException("AI response exceeds size limit");
                    }
                }
            };
        }

        private void check() {
            BusinessException reason = aborted.get();
            if (reason != null) throw reason;
            if (cancelled.getAsBoolean()) {
                abort(new BusinessException(499, "客户端已断开，已停止本次请求"));
                throw aborted.get();
            }
        }

        @Override public void close() {
            watcher.cancel(false);
            pending.cancel(true);
            InputStream current = body.getAndSet(null);
            if (current != null) {
                try { current.close(); } catch (IOException ignored) { /* connection already closed */ }
            }
        }
    }
}
