package com.timetable.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.LlmProperties;
import com.timetable.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

/**
 * 多 provider 的分级路由与故障降级（成本治理 6.1）。
 *
 * <p>这里钉住的是<b>失败路径的语义</b>，不是 HTTP 细节——HTTP 那层由既有集成测试覆盖。
 * 最要紧的一条：流式调用一旦吐过内容就绝不能切 provider，否则用户会看到两份正文。
 */
class LlmRoutingTest {

    /** 可编程的假客户端：按需返回固定回复或抛指定异常。 */
    private static final class FakeClient implements LlmClient {
        private final String id;
        private final boolean configured;
        private final String reply;
        private final RuntimeException failure;
        /** 流式：先吐出这段内容再失败/返回。null 表示一个字都不吐。 */
        private final String streamPrefix;
        private final AtomicInteger nonStreamCalls = new AtomicInteger();
        private final AtomicInteger streamCalls = new AtomicInteger();

        FakeClient(String id, boolean configured, String reply, RuntimeException failure, String streamPrefix) {
            this.id = id;
            this.configured = configured;
            this.reply = reply;
            this.failure = failure;
            this.streamPrefix = streamPrefix;
        }

        static FakeClient ok(String id, String reply) {
            return new FakeClient(id, true, reply, null, null);
        }

        static FakeClient failing(String id, RuntimeException failure) {
            return new FakeClient(id, true, null, failure, null);
        }

        static FakeClient failingAfterStream(String id, RuntimeException failure, String prefix) {
            return new FakeClient(id, true, null, failure, prefix);
        }

        static FakeClient unconfigured(String id) {
            return new FakeClient(id, false, null, null, null);
        }

        @Override public String providerId() { return id; }
        @Override public boolean isConfigured() { return configured; }

        @Override public String chatJson(List<Message> messages) {
            nonStreamCalls.incrementAndGet();
            if (failure != null) {
                throw failure;
            }
            return reply;
        }

        @Override public String chatJsonStream(List<Message> messages, LlmClient.StreamListener listener,
                                               java.util.function.BooleanSupplier cancelled) {
            streamCalls.incrementAndGet();
            if (streamPrefix != null) {
                listener.onContent(streamPrefix);
            }
            if (failure != null) {
                throw failure;
            }
            return reply == null ? "" : reply;
        }
    }

    private static List<LlmClient.Message> payload() {
        return List.of(new LlmClient.Message("user", "hi"));
    }

    @Test
    void nonStreamFallsBackToBackupWhenPrimaryFails() {
        FakeClient primary = FakeClient.failing("primary", new BusinessException(502, "上游故障"));
        FakeClient backup = FakeClient.ok("backup", "{\"ok\":true}");
        LlmClient client = new FallbackLlmClient(List.of(primary, backup));

        assertEquals("{\"ok\":true}", client.chatJson(payload()));
        assertEquals(1, primary.nonStreamCalls.get());
        assertEquals(1, backup.nonStreamCalls.get());
    }

    @Test
    void clientDisconnectIsNotRetried() {
        // 499 = 用户已经断开，再切一家重试纯属浪费上游配额
        FakeClient primary = FakeClient.failing("primary", new BusinessException(499, "客户端已断开"));
        FakeClient backup = FakeClient.ok("backup", "x");

        BusinessException thrown = assertThrows(BusinessException.class,
                () -> new FallbackLlmClient(List.of(primary, backup)).chatJson(payload()));
        assertEquals(499, thrown.getCode());
        assertEquals(0, backup.nonStreamCalls.get());
    }

    @Test
    void streamDoesNotSwitchAfterContentWasProduced() {
        // 已经吐过正文再切 provider，用户会看到两份内容拼在一起——宁可失败
        FakeClient primary = FakeClient.failingAfterStream("primary",
                new BusinessException(502, "中途断流"), "已经吐出的内容");
        FakeClient backup = FakeClient.ok("backup", "完整回复");

        LlmClient client = new FallbackLlmClient(List.of(primary, backup));
        StringBuilder seen = new StringBuilder();
        assertThrows(BusinessException.class,
                () -> client.chatJsonStream(payload(), new LlmClient.StreamListener() {
                    @Override public void onReasoning(String delta) { seen.append(delta); }
                    @Override public void onContent(String delta) { seen.append(delta); }
                }));

        assertEquals("已经吐出的内容", seen.toString());
        assertEquals(0, backup.streamCalls.get(), "已产出内容后不应再调用备用 provider");
    }

    @Test
    void streamSwitchesWhenNothingProducedYet() {
        FakeClient primary = FakeClient.failing("primary", new BusinessException(429, "限流"));
        FakeClient backup = FakeClient.ok("backup", "备用回复");

        String result = new FallbackLlmClient(List.of(primary, backup))
                .chatJsonStream(payload(), new LlmClient.StreamListener() {
                    @Override public void onReasoning(String delta) { }
                    @Override public void onContent(String delta) { }
                });

        assertEquals("备用回复", result);
        assertEquals(1, backup.streamCalls.get());
    }

    @Test
    void allProvidersFailingReturnsLastError() {
        FakeClient primary = FakeClient.failing("primary", new BusinessException(502, "A 挂了"));
        FakeClient backup = FakeClient.failing("backup", new BusinessException(502, "B 也挂了"));

        BusinessException thrown = assertThrows(BusinessException.class,
                () -> new FallbackLlmClient(List.of(primary, backup)).chatJson(payload()));
        assertEquals("B 也挂了", thrown.getMessage());
    }

    @Test
    void unconfiguredProviderIsSkipped() {
        FakeClient primary = FakeClient.unconfigured("primary");
        FakeClient backup = FakeClient.ok("backup", "ok");
        assertEquals("ok", new FallbackLlmClient(List.of(primary, backup)).chatJson(payload()));
        assertEquals(0, primary.nonStreamCalls.get());
    }

    private LlmClientRegistry registry(LlmProperties properties, LlmClient... clients) {
        @SuppressWarnings("unchecked")
        ObjectProvider<LlmProviderSettings> providerSettings = mock(ObjectProvider.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<ObjectMapper> objectMapperProvider = mock(ObjectProvider.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<LlmUsageRecorder> usageRecorderProvider = mock(ObjectProvider.class);
        return new LlmClientRegistry(List.of(clients), properties, mock(LlmBudgetService.class),
                providerSettings, objectMapperProvider, usageRecorderProvider);
    }

    @Test
    void sceneRoutePicksTheConfiguredProvider() {
        LlmProperties properties = new LlmProperties();
        properties.setActiveProvider("main");
        properties.setRoutes(Map.of("EXTRACT", "cheap"));
        FakeClient main = FakeClient.ok("main", "m");
        FakeClient cheap = FakeClient.ok("cheap", "c");

        LlmClientRegistry clients = registry(properties, main, cheap);
        assertEquals("cheap", clients.forScene("EXTRACT").providerId());
        assertEquals("main", clients.forScene("CHAT").providerId(), "未配置路由的场景走 active-provider");
        assertEquals("main", clients.active().providerId());
    }

    @Test
    void sceneRouteFallsBackWhenRoutedProviderUnavailable() {
        // 路由指向的 provider 没配 Key：不能整站 503，应退回任一可用的
        LlmProperties properties = new LlmProperties();
        properties.setActiveProvider("main");
        properties.setRoutes(Map.of("EXTRACT", "cheap"));
        FakeClient main = FakeClient.ok("main", "m");
        FakeClient cheap = FakeClient.unconfigured("cheap");

        assertEquals("main", registry(properties, main, cheap).forScene("EXTRACT").providerId());
    }

    @Test
    void fallbackChainIsAppendedWhenConfigured() {
        LlmProperties properties = new LlmProperties();
        properties.setActiveProvider("main");
        properties.setFallback(List.of("backup"));
        FakeClient main = FakeClient.failing("main", new BusinessException(502, "挂了"));
        FakeClient backup = FakeClient.ok("backup", "ok");

        // 主 provider 失败时自动切到 fallback 链里的备用
        assertEquals("ok", registry(properties, main, backup).active().chatJson(payload()));
    }

    @Test
    void nothingConfiguredThrows503() {
        LlmProperties properties = new LlmProperties();
        properties.setActiveProvider("main");
        LlmClientRegistry clients = registry(properties, FakeClient.unconfigured("main"));

        BusinessException thrown = assertThrows(BusinessException.class, clients::active);
        assertEquals(503, thrown.getCode());
    }

    @Test
    void registeredProvidersAreExposed() {
        LlmProperties properties = new LlmProperties();
        LlmClientRegistry clients = registry(properties,
                FakeClient.ok("main", "m"), FakeClient.unconfigured("second"));
        assertEquals(List.of("main", "second"), clients.registeredProviders());
    }
}
