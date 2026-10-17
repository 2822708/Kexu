package com.timetable.service;

import com.timetable.entity.LlmUsage;
import com.timetable.interceptor.RequestContext;

import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * 预算拦截装饰器（成本治理 P0-2）。
 *
 * <p>由 {@link LlmClientRegistry#active()} 包在真实客户端外面，因此<b>所有</b>
 * provider 与<b>所有</b>调用点都自动带上预算检查，不需要在每个业务方法里补一行。
 * 关键点：检查发生在 delegate 调用之前，超限的调用一次 token 都不会花。
 *
 * <p>它不是 Spring bean——否则会被 {@code LlmClientRegistry} 的
 * {@code List<LlmClient>} 收集进去，自己包自己。
 *
 * <p><b>身份从 {@link RequestContext} 取而不是参数传</b>：预算按工作区（api_key）
 * 统计，与用量看板、Dashboard 同一套单用户模型。放在这里取可以让调用方零感知。
 */
public class BudgetAwareLlmClient implements LlmClient {

    private final LlmClient delegate;
    private final LlmBudgetService budget;

    public BudgetAwareLlmClient(LlmClient delegate, LlmBudgetService budget) {
        this.delegate = delegate;
        this.budget = budget;
    }

    @Override
    public String providerId() {
        return delegate.providerId();
    }

    @Override
    public boolean isConfigured() {
        return delegate.isConfigured();
    }

    @Override
    public String chatJson(List<Message> messages) {
        budget.check(RequestContext.getApiKey(), LlmUsage.SCENE_UNKNOWN);
        return delegate.chatJson(messages);
    }

    @Override
    public String chatJson(String scene, List<Message> messages) {
        budget.check(RequestContext.getApiKey(), scene);
        return delegate.chatJson(scene, messages);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener) {
        budget.check(RequestContext.getApiKey(), LlmUsage.SCENE_UNKNOWN);
        return delegate.chatJsonStream(messages, listener);
    }

    @Override
    public String chatJsonStream(List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        budget.check(RequestContext.getApiKey(), LlmUsage.SCENE_UNKNOWN);
        return delegate.chatJsonStream(messages, listener, cancelled);
    }

    @Override
    public String chatJsonStream(String scene, List<Message> messages, StreamListener listener,
                                 BooleanSupplier cancelled) {
        budget.check(RequestContext.getApiKey(), scene);
        return delegate.chatJsonStream(scene, messages, listener, cancelled);
    }
}
