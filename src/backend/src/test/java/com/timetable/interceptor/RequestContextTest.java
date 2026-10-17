package com.timetable.interceptor;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 身份作用域助手的行为契约。
 *
 * <p>对应真实缺陷：AI 流式对话跑在 streamExecutor 工作线程上，ThreadLocal 身份丢失，
 * 导致用量静默不计、预算静默不拦。修复的语义分两层——
 * 本类锁定 {@link RequestContext#callWithApiKey} 本身（带身份执行、用完恢复），
 * 集成层由 {@code AiStreamIdentityIntegrationTest} 锁定（工作线程里确实看得到身份）。
 */
class RequestContextTest {

    private static final String CALLER = "device_" + "c".repeat(43);
    private static final String WORKER = "device_" + "w".repeat(43);

    @AfterEach
    void resetThreadState() {
        RequestContext.clear();
    }

    @Test
    void 任务执行期间能取到传入的身份() {
        AtomicReference<String> seen = new AtomicReference<>("(未执行)");
        RequestContext.callWithApiKey(WORKER, () -> seen.set(RequestContext.getApiKey()));
        assertThat(seen.get()).isEqualTo(WORKER);
    }

    @Test
    void 任务结束后线程不残留身份() {
        RequestContext.callWithApiKey(WORKER, () -> {
        });
        // 线程池会复用线程：残留身份会让下一个请求的花费记到这个账号上
        assertThat(RequestContext.getApiKey()).isNull();
    }

    @Test
    void 调用方原有身份在任务结束后原样恢复() {
        RequestContext.setApiKey(CALLER);
        RequestContext.callWithApiKey(WORKER,
                () -> assertThat(RequestContext.getApiKey()).isEqualTo(WORKER));
        assertThat(RequestContext.getApiKey()).isEqualTo(CALLER);
    }

    @Test
    void 任务抛异常时身份照样恢复且异常向上传播() {
        RequestContext.setApiKey(CALLER);
        assertThatThrownBy(() -> RequestContext.callWithApiKey(WORKER, () -> {
            throw new IllegalStateException("任务炸了");
        })).isInstanceOf(IllegalStateException.class).hasMessage("任务炸了");
        assertThat(RequestContext.getApiKey()).isEqualTo(CALLER);
    }

    @Test
    void 嵌套调用按栈恢复最外层身份() {
        RequestContext.setApiKey(CALLER);
        RequestContext.callWithApiKey(WORKER, () -> RequestContext.callWithApiKey("device_inner", () -> {
            assertThat(RequestContext.getApiKey()).isEqualTo("device_inner");
        }));
        assertThat(RequestContext.getApiKey()).isEqualTo(CALLER);
    }
}
