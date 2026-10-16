package com.timetable.service;

import java.util.List;

/**
 * LLM 客户端抽象（AI Campus Agent V1.0）。
 *
 * 现有 DeepSeek 直连调用收敛到本接口：所有 AI 调用（对话、解析、提炼）只依赖
 * {@code LlmClient}，不感知具体厂商。协议是 OpenAI 兼容的 chat/completions，
 * 未来接入同族模型（或其它兼容服务）只需新增一个实现并注册 providerId，
 * 由 {@link LlmClientRegistry} 按 {@code app.llm.active-provider} 选择。
 */
public interface LlmClient {

    /** provider 唯一标识，如 "deepseek"。 */
    String providerId();

    class Message {
        private final String role;
        private final String content;
        private final String imageDataUrl;

        public Message(String role, String content) {
            this(role, content, null);
        }

        public Message(String role, String content, String imageDataUrl) {
            this.role = role;
            this.content = content;
            this.imageDataUrl = imageDataUrl;
        }

        public String getRole() { return role; }
        public String getContent() { return content; }
        public String getImageDataUrl() { return imageDataUrl; }
    }

    /**
     * 流式回调。思考阶段与正文阶段分开通知，便于前端展示「思考中 → 输出 → 执行」三阶段。
     */
    interface StreamListener {
        /** 收到推理内容增量（thinking 阶段） */
        void onReasoning(String delta);

        /** 收到正文 JSON 增量 */
        void onContent(String delta);
    }

    /**
     * 以 JSON Mode 调用模型，返回模型输出的原始字符串（应为 JSON 文本）。
     */
    String chatJson(List<Message> messages);

    /**
     * 带场景标识的 JSON Mode 调用（成本治理 P0-1）。
     *
     * <p>新增的 {@code scene} 只用于 token 用量埋点，见
     * {@link com.timetable.entity.LlmUsage} 的 {@code SCENE_*} 常量。
     * 走这个重载才能把调用归到正确场景，统计页才有分场景成本数据。
     *
     * <p>默认实现委托到 {@link #chatJson(List)}，因此既有实现类与既有 8 处调用
     * 都无需改动——这是本方法的向后兼容保证。
     */
    default String chatJson(String scene, List<Message> messages) {
        return chatJson(messages);
    }

    /**
     * 流式调用，边接收边回调，最终返回拼接完成的完整原始输出。
     */
    default String chatJsonStream(List<Message> messages, StreamListener listener) {
        return chatJsonStream(messages, listener, () -> false);
    }

    /**
     * 带场景标识的流式调用（成本治理 P0-1）。默认委托到
     * {@link #chatJsonStream(List, StreamListener, BooleanSupplier)}，向后兼容。
     *
     * <p>聊天是流式的主路径，不用这个重载会漏掉大部分 token 计量。
     */
    default String chatJsonStream(String scene, List<Message> messages, StreamListener listener,
                                  java.util.function.BooleanSupplier cancelled) {
        return chatJsonStream(messages, listener, cancelled);
    }

    /**
     * 可取消的流式调用。{@code cancelled} 返回 true 时立刻中断读取并抛出异常。
     *
     * 客户端断开后必须停止上游调用：否则工作线程会一直读到上游自然结束（最长
     * timeout-seconds），期间白占线程池额度，而且结束之后还会把用户永远看不到的
     * 回复与提案写进库。
     *
     * @param messages 完整对话上下文
     * @param listener 增量回调
     * @param cancelled 取消判定，每个数据块前检查一次
     * @return 拼接完成的完整原始输出
     */
    String chatJsonStream(List<Message> messages, StreamListener listener,
                          java.util.function.BooleanSupplier cancelled);

    boolean isConfigured();
}
