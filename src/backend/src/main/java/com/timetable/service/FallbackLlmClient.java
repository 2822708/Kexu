package com.timetable.service;

import com.timetable.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * 故障降级：主 provider 调用失败时按顺序切到备用 provider（成本治理 6.1）。
 *
 * <p>多挂一个 provider 的目的就是消除单点故障（Key 过期、厂商限流、机房故障），
 * 所以失败自动切换是默认行为；想彻底关掉用 {@code app.llm.fallback-enabled=false}。
 *
 * <p><b>流式的重试有个硬约束</b>：一旦已经往前端吐过正文，就不能再切 provider 重来——
 * 否则用户会看到两份内容拼在一起。所以流式调用用一个计数监听器盯着，只在
 * 「一个字都还没吐出去」时才允许切换；已经吐了内容再失败，就如实把错误抛上去。
 *
 * <p>非流式没有这个顾虑，可以放心重试：它是一次性的请求/响应，没有中间状态。
 */
public class FallbackLlmClient implements LlmClient {

    private static final Logger log = LoggerFactory.getLogger(FallbackLlmClient.class);

    private final List<LlmClient> chain;

    /**
     * @param chain 按优先级排列的客户端，第一个是主用。至少需要一个元素。
     */
    public FallbackLlmClient(List<LlmClient> chain) {
        if (chain == null || chain.isEmpty()) {
            throw new IllegalArgumentException("fallback chain must not be empty");
        }
        this.chain = new ArrayList<>(chain);
    }

    @Override
    public String providerId() {
        return chain.get(0).providerId();
    }

    @Override
    public boolean isConfigured() {
        for (LlmClient client : chain) {
            if (client.isConfigured()) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String chatJson(List<Message> messages) {
        return chatJson(null, messages);
    }

    @Override
    public String chatJson(String scene, List<Message> messages) {
        return runNonStream(scene, messages);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener) {
        return chatJsonStream(null, messages, listener, () -> false);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        return chatJsonStream(null, messages, listener, cancelled);
    }

    @Override
    public String chatJsonStream(String scene, List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        BusinessException last = null;
        for (int i = 0; i < chain.size(); i++) {
            LlmClient client = chain.get(i);
            if (!client.isConfigured()) {
                continue;
            }
            CountingListener guardListener = new CountingListener(listener);
            try {
                return client.chatJsonStream(scene, messages, guardListener, cancelled);
            } catch (BusinessException failure) {
                last = failure;
                if (guardListener.produced()) {
                    // 已经吐过内容：切换会导致前端收到两份正文，宁可失败
                    log.warn("[{}] 流式调用在产出内容后失败，不再切换 provider", client.providerId());
                    throw failure;
                }
                if (!retryable(failure) || i == chain.size() - 1) {
                    throw failure;
                }
                log.warn("[{}] 调用失败（{}），切换到备用 provider {}",
                        client.providerId(), failure.getMessage(), chain.get(i + 1).providerId());
            }
        }
        throw last != null ? last
                : new BusinessException(503, "AI 服务未配置或暂时不可用，请稍后再试");
    }

    private String runNonStream(String scene, List<Message> messages) {
        BusinessException last = null;
        for (int i = 0; i < chain.size(); i++) {
            LlmClient client = chain.get(i);
            if (!client.isConfigured()) {
                continue;
            }
            try {
                return scene == null ? client.chatJson(messages) : client.chatJson(scene, messages);
            } catch (BusinessException failure) {
                last = failure;
                if (!retryable(failure) || i == chain.size() - 1) {
                    throw failure;
                }
                log.warn("[{}] 调用失败（{}），切换到备用 provider {}",
                        client.providerId(), failure.getMessage(), chain.get(i + 1).providerId());
            }
        }
        throw last != null ? last
                : new BusinessException(503, "AI 服务未配置或暂时不可用，请稍后再试");
    }

    /**
     * 哪些失败值得换一家重试。
     *
     * <p>不重试的两类：客户端已断开（499，用户都走了，重试纯属浪费）、
     * 参数非法（重试多少次都一样）。配额/鉴权/上游错误（401/429/502/504…）换一家
     * 往往就能成功——这正是配第二个 provider 的意义。
     */
    private boolean retryable(BusinessException failure) {
        int code = failure.getCode();
        return code != 499;
    }

    /** 记录是否已经向前端吐出过内容（含思考阶段）。 */
    private static final class CountingListener implements StreamListener {
        private final StreamListener delegate;
        private volatile boolean produced;

        private CountingListener(StreamListener delegate) {
            this.delegate = delegate;
        }

        @Override
        public void onReasoning(String delta) {
            if (delta != null && !delta.isEmpty()) {
                produced = true;
            }
            delegate.onReasoning(delta);
        }

        @Override
        public void onContent(String delta) {
            if (delta != null && !delta.isEmpty()) {
                produced = true;
            }
            delegate.onContent(delta);
        }

        boolean produced() {
            return produced;
        }
    }
}
