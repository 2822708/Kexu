package com.timetable.service;

import com.sun.net.httpserver.HttpServer;
import com.timetable.config.LlmProviderConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * provider 连通性测试（成本治理 6.1 #2 收尾）。
 *
 * <p>用真实的本地 HTTP 服务当上游，而不是 mock：这里要验证的正是「HTTP 状态码怎么翻译成人话」，
 * mock 掉 HTTP 层等于把要测的东西测没了。
 */
class LlmProviderProbeTest {

    private final LlmProviderProbe probe = new LlmProviderProbe();
    private HttpServer server;
    private String baseUrl;
    /** 最近一次收到的 Authorization 头，用来确认 Key 真的发出去了 */
    private final AtomicReference<String> lastAuth = new AtomicReference<>();

    @BeforeEach
    void startServer() throws Exception {
        startServer(200);
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private void startServer(int status) throws Exception {
        if (server != null) {
            server.stop(0);
        }
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            lastAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            // 把请求体读掉，避免连接被对端重置
            exchange.getRequestBody().readAllBytes();
            String body = status == 200
                    // 真实 OpenAI 响应必须带 finish_reason：客户端拒绝「未正常结束」的回复，
                    // 少了这个字段测出来的就是解析失败而不是连通性
                    ? "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"可用\"}}],"
                            + "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}"
                    : "{\"error\":{\"message\":\"Invalid API key: sk-should-be-scrubbed\"}}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    }

    @Test
    void successfulProbeReportsLatencyAndReply() {
        Map<String, Object> result = probe.probe("local-ok", config("sk-probe-key"));

        assertThat(result.get("ok")).isEqualTo(true);
        assertThat(result.get("providerId")).isEqualTo("local-ok");
        assertThat(result.get("model")).isEqualTo("test-model");
        assertThat(result.get("reply")).isEqualTo("可用");
        assertThat((Long) result.get("latencyMs")).isGreaterThanOrEqualTo(0L);
        assertThat(lastAuth.get()).as("Key 必须真的发到上游，否则测出来的「通」是假的")
                .isEqualTo("Bearer sk-probe-key");
    }

    @Test
    void invalidKeyIsTranslatedIntoActionableAdvice() throws Exception {
        startServer(401);
        Map<String, Object> result = probe.probe("bad-key", config("sk-should-be-scrubbed"));

        assertThat(result.get("ok")).isEqualTo(false);
        String error = (String) result.get("error");
        assertThat(error).contains("Key 无效");
        assertThat(error)
                .as("上游报错常把 Key 回显进 message，返回给前端前必须擦掉")
                .doesNotContain("sk-should-be-scrubbed");
    }

    @Test
    void notFoundBlamesAddressOrModel() throws Exception {
        startServer(404);
        Map<String, Object> result = probe.probe("wrong-url", config("sk-any"));

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((String) result.get("error")).contains("地址或模型名不对");
    }

    /**
     * 原文只有状态码时不该再附一遍。
     *
     * <p>「（原文：AI 服务调用失败: HTTP 401）」对用户零价值：状态码的信息已经全在
     * 前面那句翻译里了。留着只会让人以为漏看了什么。
     */
    @Test
    void bareStatusCodeIsNotRepeatedAsDetail() throws Exception {
        startServer(401);
        String error = (String) probe.probe("bad-key", config("sk-any")).get("error");

        assertThat(error).contains("Key 无效");
        assertThat(error).as("状态码没有额外线索，不该附原文").doesNotContain("原文");
    }

    /**
     * 反过来：原文真带了额外线索时不能吃掉它。
     *
     * <p>宁可多显示一句原文，也不能把上游说的「余额不足」「模型已下线」这类关键信息丢掉
     * ——那才是用户唯一能拿去查文档的线索。
     */
    @Test
    void extraDetailFromUpstreamIsPreserved() {
        String explained = probe.explainForTest("AI 服务调用失败: HTTP 429 账户余额不足");

        assertThat(explained).contains("额度用完");
        assertThat(explained).as("上游的额外说明必须保留").contains("账户余额不足");
    }

    @Test
    void incompleteConfigFailsFastWithoutNetworkCall() {
        LlmProviderConfig noKey = config("");
        Map<String, Object> result = probe.probe("no-key", noKey);

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((String) result.get("error")).contains("配置不完整");
        assertThat(lastAuth.get()).as("配置不全就不该发起请求").isNull();
    }

    /**
     * 失败时 latencyMs 也必须在。
     *
     * <p>前端拿它区分病因：0.1 秒失败是被拒（Key/地址错），3 秒失败是网络或服务慢。
     * 少了这个字段前端就得做存在性判断，或者显示成「—」，把一条现成线索丢掉。
     */
    @Test
    void everyFailureCarriesLatencySoUiCanTellFastRejectFromSlowNetwork() throws Exception {
        Map<String, Object> incomplete = probe.probe("no-key", config(""));
        assertThat(incomplete).containsKey("latencyMs");

        startServer(401);
        Map<String, Object> rejected = probe.probe("bad-key", config("sk-any"));
        assertThat(rejected).containsKey("latencyMs");

        LlmProviderConfig dead = new LlmProviderConfig();
        dead.setBaseUrl("http://127.0.0.1:1/v1");
        dead.setModel("test-model");
        dead.setApiKey("sk-any");
        dead.setTimeoutSeconds(2);
        dead.setIdleTimeoutSeconds(2);
        assertThat(probe.probe("dead", dead)).containsKey("latencyMs");
    }

    @Test
    void unreachableAddressReportsConnectionProblem() {
        LlmProviderConfig config = new LlmProviderConfig();
        // 保留端口段里一个几乎不可能有人监听的端口
        config.setBaseUrl("http://127.0.0.1:1/v1");
        config.setModel("test-model");
        config.setApiKey("sk-any");
        config.setTimeoutSeconds(2);
        config.setIdleTimeoutSeconds(2);

        Map<String, Object> result = probe.probe("dead", config);

        assertThat(result.get("ok")).isEqualTo(false);
        assertThat((String) result.get("error")).isNotBlank();
    }

    private LlmProviderConfig config(String apiKey) {
        LlmProviderConfig config = new LlmProviderConfig();
        config.setBaseUrl(baseUrl);
        config.setModel("test-model");
        config.setApiKey(apiKey);
        config.setTimeoutSeconds(5);
        config.setIdleTimeoutSeconds(5);
        return config;
    }
}
