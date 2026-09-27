package com.timetable.service;

import java.util.List;

public interface DeepSeekClient {

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
     * 以 JSON Mode 调用 DeepSeek，返回模型输出的原始字符串（应为 JSON 文本）。
     */
    String chatJson(List<Message> messages);

    /**
     * 流式调用，边接收边回调，最终返回拼接完成的完整原始输出。
     */
    default String chatJsonStream(List<Message> messages, StreamListener listener) {
        return chatJsonStream(messages, listener, () -> false);
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
