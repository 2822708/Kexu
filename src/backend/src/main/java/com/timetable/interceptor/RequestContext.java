package com.timetable.interceptor;

public class RequestContext {
    private static final ThreadLocal<String> API_KEY_HOLDER = new ThreadLocal<>();

    public static void setApiKey(String apiKey) {
        API_KEY_HOLDER.set(apiKey);
    }

    public static String getApiKey() {
        return API_KEY_HOLDER.get();
    }

    public static void clear() {
        API_KEY_HOLDER.remove();
    }

    /**
     * 在「带着指定身份」的前提下执行任务，结束后把线程恢复到调用前的身份状态。
     *
     * <p><b>为什么需要它</b>：身份存在 ThreadLocal 里，而异步任务（如 AI 流式对话跑在
     * {@code streamExecutor} 的工作线程上）天然拿不到调用方线程设的值。下游组件——
     * LLM 客户端取 apiKey 记账、预算服务按身份查额度——读到 null 时都不会报错，
     * 只会静默地不记账、不拦超限。这类失败 mock 测试抓不到（被替换掉的正是读
     * ThreadLocal 的那段代码），只有真实调用才会暴露。
     *
     * <p><b>为什么必须恢复而不是一走了之</b>：线程池的线程会被下一个请求复用。
     * 任务结束后残留的 apiKey，会让下一个请求的花费记到这个账号上——比取不到身份
     * 更危险。因此用 try/finally 保证：无论任务正常结束还是抛异常，当前线程都回到
     * 调用前的状态（原本没有身份 → 清理干净；原本有身份 → 原样恢复）。
     *
     * <p>异步派发一律走这个方法，不要在外面临时手写 set/clear——
     * 手写的那次漏掉 finally，就是一次静默的串号事故。
     */
    public static void callWithApiKey(String apiKey, Runnable task) {
        String previous = API_KEY_HOLDER.get();
        API_KEY_HOLDER.set(apiKey);
        try {
            task.run();
        } finally {
            if (previous == null) {
                API_KEY_HOLDER.remove();
            } else {
                API_KEY_HOLDER.set(previous);
            }
        }
    }
}
