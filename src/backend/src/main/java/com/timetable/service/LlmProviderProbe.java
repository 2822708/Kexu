package com.timetable.service;

import com.timetable.config.LlmProviderConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * provider 连通性测试（成本治理 6.1 #2 收尾）。
 *
 * <p>填完配置点一下就知道通不通，而不是「先生成一次计划看看有没有报错」——
 * 后者既慢又把配置问题和内容问题混在一起。
 *
 * <p>三条设计约束：
 * <ol>
 *   <li><b>只测已保存的 provider</b>：不接受前端传 baseUrl。否则这个端点就是个现成的
 *       SSRF 跳板（拿服务器的网络位置去打内网）。</li>
 *   <li><b>不写 llm_usage 埋点</b>：这是配置验证，不是业务调用。算进成本看板会让
 *       「本月花了多少」出现查不到来源的支出。测试请求传 {@code scene=null} 即走无埋点路径。</li>
 *   <li><b>失败信息脱敏</b>：上游报错常把请求头回显进 message，先过一遍擦掉 Key 再返给前端。</li>
 * </ol>
 */
@Service
public class LlmProviderProbe {

    private static final Logger log = LoggerFactory.getLogger(LlmProviderProbe.class);

    /** 测试请求的总时限。比业务超时短得多——用户在界面上等不了两分钟。 */
    static final long PROBE_TIMEOUT_SECONDS = 15L;

    /** 够验证「能连上、Key 对、模型名对」，又不至于真花钱。 */
    private static final List<LlmClient.Message> PROBE_MESSAGES = List.of(
            new LlmClient.Message("user", "回复两个字：可用"));

    private static final AtomicInteger PROBE_THREAD_SEQ = new AtomicInteger();

    /**
     * 跑一次最小调用。
     *
     * <p>失败时也带 {@code latencyMs}：用户看到「3.2 秒后失败」和「0.1 秒后失败」能自己
     * 判断是慢在网络上还是一开始就被拒了，比只给一句原因多一条线索。
     *
     * @return 结果 Map，字段：{@code ok}（boolean）、{@code providerId}、{@code model}、
     *         {@code latencyMs}、{@code reply}（截断后的模型回复）、{@code error}（失败原因）
     */
    public Map<String, Object> probe(String providerId, LlmProviderConfig config) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("providerId", providerId);
        result.put("model", config == null ? "" : config.getModel());
        // 先摆上 0，各分支成功/失败都会覆盖它；这样前端不必对 latencyMs 做存在性判断
        result.put("latencyMs", 0L);

        if (config == null || !config.isComplete()) {
            result.put("ok", false);
            result.put("error", "配置不完整：需要填好服务地址、模型名和 API Key");
            return result;
        }

        LlmClient client = LlmClientRegistry.simple(config);
        long started = System.nanoTime();
        // 上游是阻塞 IO，必须放到独立线程才能设总时限；用单线程池而非公共池，
        // 避免用户连点几次把公共池占满
        ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "llm-probe-" + PROBE_THREAD_SEQ.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        try {
            Future<String> future = executor.submit(() -> client.chatJson(PROBE_MESSAGES));
            String raw = future.get(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            long latency = (System.nanoTime() - started) / 1_000_000;
            result.put("ok", true);
            result.put("latencyMs", latency);
            result.put("reply", truncate(scrub(raw, config.getApiKey()), 60));
            log.info("provider {} 连通性测试通过（{}ms）", providerId, latency);
            return result;
        } catch (TimeoutException e) {
            result.put("ok", false);
            result.put("latencyMs", (System.nanoTime() - started) / 1_000_000);
            result.put("error", "连接超时（超过 " + PROBE_TIMEOUT_SECONDS + " 秒）："
                    + "请检查服务地址是否正确、本机网络是否能访问该地址");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() == null ? e : e.getCause();
            String message = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
            result.put("ok", false);
            result.put("latencyMs", (System.nanoTime() - started) / 1_000_000);
            result.put("error", explain(scrub(message, config.getApiKey())));
            log.warn("provider {} 连通性测试失败：{}", providerId, message);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            result.put("ok", false);
            result.put("latencyMs", (System.nanoTime() - started) / 1_000_000);
            result.put("error", "测试被中断");
        } finally {
            executor.shutdownNow();
        }
        return result;
    }

    /**
     * 把技术错误翻译成人能看懂的话。
     *
     * <p>用户看到 {@code 401 Unauthorized} 不知道怎么改；看到「Key 不对」就知道去改哪。
     * 也没必要把所有情况都翻译——说不清的时候保留原文，原文往往比瞎猜更有用。
     */
    private String explain(String message) {
        String lower = message == null ? "" : message.toLowerCase();
        if (lower.contains("401") || lower.contains("unauthorized") || lower.contains("invalid api key")
                || lower.contains("authentication")) {
            return withDetail("API Key 无效或已过期，请检查 Key 是否填对、是否属于这个服务", message);
        }
        if (lower.contains("403") || lower.contains("forbidden")) {
            return withDetail("服务拒绝访问：Key 可能没有该模型的权限，或账号未开通", message);
        }
        if (lower.contains("404") || lower.contains("not found")) {
            return withDetail("服务地址或模型名不对：确认地址要包含版本路径（如 /v4、/v1），"
                    + "模型名要与服务方文档一致", message);
        }
        if (lower.contains("429") || lower.contains("rate limit")) {
            return withDetail("请求太频繁或额度用完，稍后再试或检查账户余额", message);
        }
        if (lower.contains("unknown host") || lower.contains("connect") || lower.contains("network")) {
            return withDetail("连不上这个地址：检查地址拼写、本机网络、是否需要代理", message);
        }
        return message;
    }

    /** 给测试用的入口：{@code explain} 是纯函数，没必要为了测它去起一个假上游。 */
    String explainForTest(String message) {
        return explain(message);
    }

    /**
     * 拼上原始错误，但<b>原文只有状态码时不拼</b>。
     *
     * <p>{@code （原文：AI 服务调用失败: HTTP 401）} 这种括号对用户零价值——状态码的信息
     * 已经全在前面那句翻译里了，白占两行还会让人以为漏看了什么。只有原文带来额外线索
     * （上游的自定义报错、DNS 解析失败之类）才值得展示。
     */
    private String withDetail(String advice, String message) {
        if (message == null || message.isBlank()) {
            return advice;
        }
        if (onlyConveysStatusCode(message)) {
            return advice;
        }
        return advice + "（原文：" + message + "）";
    }

    /**
     * 原文是不是「除了状态码什么都没说」。
     *
     * <p>做法：把已知的模板词和标点都去掉，剩下若只有状态码、没有别的英文单词或数字，
     * 就算没有额外信息。宁可漏判（多显示一句原文）也不要误判（把真正的上游报错吃掉）——
     * 所以这里只认「确实只剩状态码」这一种情况。
     */
    private boolean onlyConveysStatusCode(String message) {
        // 先剥掉我们自己的模板词，再看剩下什么。顺序很重要：
        // 模板词是中文，先判「有中文就保留」会把模板词本身当成额外信息。
        String rest = message
                .replace("AI 服务调用失败", "")
                .replace("ai 服务调用失败", "")
                .trim();
        String lower = rest.toLowerCase(java.util.Locale.ROOT);
        if (!lower.matches(".*\\b[1-5]\\d\\d\\b.*")) {
            return false;
        }
        // 有非 ASCII 字符就说明上游额外说了句人话（中文报错、模型名等），一律保留。
        // 这一步要在清洗前做：否则清洗会把中文全滤掉，导致「账户余额不足」被当成空。
        if (rest.chars().anyMatch(c -> c > 127)) {
            return false;
        }
        String residue = lower.replace("http", "").replaceAll("[^a-z0-9]", "").replaceAll("[1-5]\\d\\d", "");
        return residue.isEmpty();
    }

    /** 擦掉可能被上游回显的 Key，避免它出现在界面提示或日志里。 */
    private String scrub(String text, String apiKey) {
        if (text == null || text.isBlank()) {
            return text == null ? "" : text;
        }
        if (apiKey == null || apiKey.isBlank()) {
            return text;
        }
        return text.replace(apiKey, "***");
    }

    private String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max) + "…";
    }
}
