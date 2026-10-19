package com.timetable.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.timetable.entity.LlmUsage;
import com.timetable.exception.BusinessException;
import com.timetable.interceptor.RequestContext;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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

/**
 * OpenAI 兼容 chat/completions 协议的通用客户端骨架（成本治理 6.1：多 provider）。
 *
 * <p>DeepSeek、智谱 GLM、通义、豆包以及任何 OpenAI 兼容网关的协议都是同一套
 * chat/completions，差别只在 baseUrl / 模型名 / Key / 少量可选字段。因此把
 * 「构造请求、流式解析、超时看门狗、token 埋点」这些与厂商无关的部分收敛在这里，
 * 子类只回答几个取值问题（模型、温度、超时、Key…）。
 *
 * <p>{@link DeepSeekLlmClient} 是既有实现，改造后只是本类的一个薄子类，行为不变。
 */
public abstract class AbstractOpenAiLlmClient implements LlmClient {

    protected final Logger log = LoggerFactory.getLogger(getClass());
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

    private final ObjectMapper objectMapper;
    private final LlmUsageRecorder usageRecorder;
    private final HttpClient httpClient;
    private final ScheduledExecutorService requestWatchdog = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "llm-request-watchdog");
        thread.setDaemon(true);
        return thread;
    });

    protected AbstractOpenAiLlmClient(ObjectMapper objectMapper, LlmUsageRecorder usageRecorder) {
        this.objectMapper = objectMapper;
        this.usageRecorder = usageRecorder;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .build();
    }

    // --- 子类必须回答的几个取值问题 -----------------------------------------

    /** chat/completions 的根地址，尾部斜杠会被自动去掉。 */
    protected abstract String baseUrl();

    /** 当前生效的 API Key（未配置时返回空串，由 {@link #isConfigured()} 把关）。 */
    protected abstract String apiKey();

    protected abstract String model();

    protected abstract double temperature();

    protected abstract int maxTokens();

    /** 推理强度，null/空表示不下发该字段（多数兼容服务不支持）。 */
    protected abstract String reasoningEffort();

    protected abstract int timeoutSeconds();

    protected abstract int idleTimeoutSeconds();

    // --- LlmClient 实现 ------------------------------------------------------

    @Override
    public String chatJson(List<Message> messages) {
        return execute(null, messages, null, () -> false);
    }

    @Override
    public String chatJson(String scene, List<Message> messages) {
        return execute(scene, messages, null, () -> false);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener) {
        return execute(null, messages, listener, () -> false);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        return execute(null, messages, listener, cancelled);
    }

    @Override
    public String chatJsonStream(String scene, List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        return execute(scene, messages, listener, cancelled);
    }

    @PreDestroy
    public void shutdownWatchdog() {
        requestWatchdog.shutdownNow();
    }

    private ObjectNode buildBody(List<Message> messages, boolean stream) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", model());
        body.put("temperature", temperature());
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
        body.put("max_tokens", maxTokens());
        String effort = reasoningEffort();
        if (effort != null && !effort.isBlank()) {
            body.put("reasoning_effort", effort);
        }
        if (stream) {
            body.put("stream", true);
            // 成本治理 P0-1：不开这个开关，流式调用（聊天的主力路径）拿不到 usage，
            // 统计会漏掉大头。上游在最后一个 chunk 返回 usage。
            body.putObject("stream_options").put("include_usage", true);
        }
        return body;
    }

    /**
     * 一次调用的 token 用量（成本治理 P0-1）。
     *
     * <p>非流式：整包响应里直接读 usage。流式：开启
     * {@code stream_options.include_usage} 后，上游在<b>最后一个</b> chunk 返回
     * usage，此时 choices 为空数组。上游没返回时保持 0，统计侧按未知处理，
     * 绝不因为拿不到 usage 而影响业务。
     */
    protected static final class Usage {
        private int promptTokens;
        private int completionTokens;
        /** null = 上游未报缓存字段；0 = 报了但没命中。两者不可合并，详见 LlmUsage 字段注释。 */
        private Integer cacheHitTokens;
        private Integer cacheMissTokens;

        void setFrom(JsonNode usage) {
            if (usage == null || !usage.isObject()) {
                return;
            }
            promptTokens = usage.path("prompt_tokens").asInt(0);
            completionTokens = usage.path("completion_tokens").asInt(0);
            readCacheFields(usage);
        }

        /**
         * 读缓存命中字段（成本治理 6.1 #4）。
         *
         * <p><b>两家的字段名不一样，必须都认</b>：
         * <ul>
         *   <li>DeepSeek：{@code prompt_cache_hit_tokens} / {@code prompt_cache_miss_tokens}</li>
         *   <li>OpenAI：{@code prompt_tokens_details.cached_tokens}（只给命中数，不给 miss）</li>
         * </ul>
         * 只认其中一家，另一家的缓存就等于白做了——而且不会报错，只是统计里永远 0 命中，
         * 这正是「静默失效」的典型形态，所以两家都读，读不到才算 null。
         *
         * <p>OpenAI 只报 cached_tokens，miss 用 prompt_tokens - cached 反推；
         * DeepSeek 两家都报，优先用它的值（反推在流式与重试场景下未必精确）。
         */
        private void readCacheFields(JsonNode usage) {
            JsonNode hit = usage.path("prompt_cache_hit_tokens");
            JsonNode miss = usage.path("prompt_cache_miss_tokens");
            if (hit.isNumber() || miss.isNumber()) {
                cacheHitTokens = hit.isNumber() ? hit.asInt() : null;
                cacheMissTokens = miss.isNumber() ? miss.asInt() : null;
                return;
            }
            JsonNode cached = usage.path("prompt_tokens_details").path("cached_tokens");
            if (cached.isNumber()) {
                int cachedTokens = Math.min(cached.asInt(), promptTokens);
                cacheHitTokens = cachedTokens;
                cacheMissTokens = Math.max(0, promptTokens - cachedTokens);
            }
        }

        int promptTokens() { return promptTokens; }
        int completionTokens() { return completionTokens; }
        Integer cacheHitTokens() { return cacheHitTokens; }
        Integer cacheMissTokens() { return cacheMissTokens; }
    }

    /**
     * 已耗时的毫秒数。饱和转换而非直接强转：系统时钟回拨或长时间挂起时
     * {@code long} 差值可能为负或溢出 int，直接转会得到负的延迟。
     */
    private static int elapsedMs(long startedAt) {
        long diff = System.currentTimeMillis() - startedAt;
        if (diff <= 0) {
            return 0;
        }
        return diff > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) diff;
    }

    private String execute(String scene, List<Message> messages, StreamListener listener,
                           BooleanSupplier cancelled) {
        if (!isConfigured()) {
            throw new BusinessException(503, "AI 服务未配置（provider=" + providerId() + "），AI 功能不可用");
        }
        boolean stream = listener != null;
        ObjectNode body = buildBody(messages, stream);
        // 埋点是旁路观测：apiKey 拿不到（理论上不该发生）就整次跳过，不影响业务。
        String apiKey = RequestContext.getApiKey();
        long startedAt = System.currentTimeMillis();
        Usage usage = new Usage();

        try {
            if (cancelled.getAsBoolean()) {
                throw new BusinessException(499, "客户端已断开，未发起 AI 请求");
            }
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl().replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofSeconds(Math.max(1, timeoutSeconds())))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body), StandardCharsets.UTF_8))
                    .build();

            CompletableFuture<HttpResponse<InputStream>> pending =
                    httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
            try (CallGuard guard = new CallGuard(pending, cancelled,
                    Math.max(1, timeoutSeconds()),
                    Math.max(1, idleTimeoutSeconds()))) {
                try {
                    HttpResponse<InputStream> response = guard.awaitResponse();
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        try (InputStream errorBody = guard.boundedBody()) {
                            errorBody.readNBytes(4096);
                        }
                        log.warn("[{}] LLM API returned HTTP {}", providerId(), response.statusCode());
                        throw new BusinessException(502, "AI 服务调用失败: HTTP " + response.statusCode());
                    }
                    String result = stream
                            ? readStream(guard, listener, usage)
                            : readJsonResponse(guard, usage);
                    guard.check();
                    if (usageRecorder != null) {
                        usageRecorder.recordSuccess(apiKey, scene, providerId(), model(),
                                usage.promptTokens(), usage.completionTokens(), stream,
                                elapsedMs(startedAt), usage.cacheHitTokens(), usage.cacheMissTokens());
                    }
                    return result;
                } catch (Exception failure) {
                    guard.check();
                    // 失败也记录：token 已经花掉是真实成本，只记成功会低估开销。
                    // usageRecorder 可为 null（连通性测试用的一次性客户端不参与成本统计，
                    // 否则成本看板会多出查不到来源的支出）
                    if (usageRecorder != null) {
                        usageRecorder.recordError(apiKey, scene, providerId(), model(),
                                usage.promptTokens(), usage.completionTokens(), stream,
                                elapsedMs(startedAt), usage.cacheHitTokens(), usage.cacheMissTokens());
                    }
                    throw failure;
                }
            }
        } catch (BusinessException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException(502, "AI 服务调用被中断");
        } catch (ExecutionException e) {
            log.warn("[{}] LLM API request failed: {}", providerId(), e.getCause().getClass().getSimpleName());
            throw new BusinessException(502, "AI 服务调用失败，请重试");
        } catch (Exception e) {
            log.warn("[{}] LLM API request failed: {}", providerId(), e.getClass().getSimpleName());
            throw new BusinessException(502, "AI 服务调用失败，请重试");
        }
    }

    private String readJsonResponse(CallGuard guard, Usage usage) throws IOException {
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
        // 成本治理 P0-1：先读 usage 再做业务校验，这样即使 finish_reason 不合法
        // 也要先记下已消耗的 token（token 已经花掉了）。
        usage.setFrom(root.path("usage"));
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

    private String readStream(CallGuard guard, StreamListener listener, Usage usage) throws IOException {
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
                // 成本治理 P0-1：开启 include_usage 后，usage 出现在最后一个
                // chunk（此时 choices 为空数组，path(0) 返回 MissingNode，
                // 下面的取值逻辑天然跳过，不用额外分支）。
                if (chunk.has("usage")) {
                    usage.setFrom(chunk.path("usage"));
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
            log.error("[{}] LLM returned no content, finish_reason={}", providerId(), finishReason);
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
