package com.timetable.service.impl;

import org.mozilla.javascript.ClassShutter;
import org.mozilla.javascript.CompilerEnvirons;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.EvaluatorException;
import org.mozilla.javascript.Parser;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.ast.AstRoot;
import org.mozilla.javascript.ast.RegExpLiteral;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.IsoFields;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 用户自定义循环规则的脚本执行器（沙箱）。
 *
 * 用户用 JavaScript 写一个 shouldTrigger(ctx) 函数返回布尔值，决定当前时刻是否触发。
 *
 * 安全措施（执行不可信代码，必须全部具备）：
 * 1. ClassShutter 阻断所有 Java 类访问 —— 杜绝 java.lang.Runtime 等反射逃逸
 * 2. safe standard objects —— 作用域内不含 Packages/java/getClass/JavaAdapter/importClass
 *    等 LiveConnect 桥接（该保护与是否密封无关；本类特意不密封，见第 3 条）
 * 3. 消除无界原生执行入口 —— 源码层拒绝正则字面量，运行时顶替 RegExp/eval/Function
 *    与 RegExp.prototype.test/exec、String.prototype.match/search
 * 4. 指令计数中断 —— 防死循环 / 长时间占用 CPU
 * 5. 解释器栈深限制 + 堆增长哨兵 + 工作线程内捕获 OOM/StackOverflow
 * 6. 脚本长度上限
 * 7. 并发许可 —— 每个求值占用一个许可，被遗弃的线程不归还许可，因此失控脚本的数量有硬上限
 *
 * <p><b>已知限制（不要在文档里宣称已完全解决）</b>：JVM 无法安全抢占一次正在执行的原生
 * （Java）调用，因此单靠进程内手段无法保证「超时即终止」。本类通过第 3 条关掉已证实的
 * 无界原生入口、通过第 7 条把最坏情况限制在 {@link #MAX_CONCURRENT_EVALUATIONS} 个
 * 失控线程以内（用满后求值失败关闭，不再接受新脚本），从而把「无界资源耗尽」降级为
 * 「有界且可告警」。彻底的方案是把求值移出本进程（独立 JVM，可强杀），见 TODO。
 */
@Component
public class RecurringScriptEvaluator {

    private static final Logger log = LoggerFactory.getLogger(RecurringScriptEvaluator.class);

    /** 指令计数上限，超出即中断（约相当于百万级基础操作） */
    private static final int MAX_INSTRUCTIONS = 2_000_000;
    /** 单次执行墙钟超时 */
    private static final long TIMEOUT_MS = 1500L;
    /** 超时后等待线程自行退出的宽限期，仍不退则视为遗弃 */
    private static final long ABANDON_GRACE_MS = 300L;
    public static final int MAX_SCRIPT_LENGTH = 4000;
    /** 脚本运行期允许新增的堆内存上限，防「字符串炸弹」等内存耗尽攻击 */
    private static final long MAX_HEAP_GROWTH_BYTES = 64L * 1024 * 1024;
    /**
     * 指令观察间隔。设得足够小，才能在「字符串炸弹」这类循环次数极少、
     * 但每轮内存翻倍的脚本造成 OOM 之前介入。
     */
    private static final int OBSERVER_THRESHOLD = 200;
    /** 解释器调用栈深度上限，防无限递归耗尽堆内存 */
    private static final int MAX_STACK_DEPTH = 256;
    /**
     * 同时进行的脚本求值上限。被遗弃（无法终止）的线程不归还许可，
     * 因此失控线程总数不会超过该值 —— 最坏情况下丢一个核心，而不是无限增长。
     */
    private static final int MAX_CONCURRENT_EVALUATIONS = 2;

    private static final String FUNCTION_NAME = "shouldTrigger";

    /** 用来顶替 RegExp / eval / Function 的桩函数：正则与动态代码直接抛错 */
    private static final String BLOCKED_STUB_JS =
            "(function(){ throw new Error('沙箱内禁止使用正则表达式与动态代码（RegExp / eval / Function）'); })";

    /**
     * 沙箱 ContextFactory：开启指令观察以支持中断。
     */
    private static final class SandboxFactory extends ContextFactory {
        @Override
        protected void onContextCreated(Context cx) {
            cx.setInstructionObserverThreshold(OBSERVER_THRESHOLD);
            super.onContextCreated(cx);
        }

        @Override
        protected void observeInstructionCount(Context cx, int instructionCount) {
            Counter counter = (Counter) cx.getThreadLocal(Counter.KEY);
            if (counter != null) {
                counter.count += OBSERVER_THRESHOLD;
                if (counter.count > MAX_INSTRUCTIONS) {
                    throw new ScriptAbortError("脚本执行步数过多，可能存在死循环");
                }
                // 内存哨兵：字符串/数组炸弹的循环次数很少，指令计数抓不到，需单独看堆增长
                if (counter.baselineHeap > 0) {
                    long used = usedHeap();
                    if (used - counter.baselineHeap > MAX_HEAP_GROWTH_BYTES) {
                        throw new ScriptAbortError("脚本占用内存过多，已终止");
                    }
                }
            }
            if (System.currentTimeMillis() - startOf(cx) > TIMEOUT_MS) {
                throw new ScriptAbortError("脚本执行超时");
            }
            super.observeInstructionCount(cx, instructionCount);
        }

        private long startOf(Context cx) {
            Object v = cx.getThreadLocal("startAt");
            return v instanceof Long l ? l : System.currentTimeMillis();
        }
    }

    private static final class Counter {
        static final String KEY = "instructionCounter";
        long count;
        long baselineHeap;
    }

    private static long usedHeap() {
        Runtime rt = Runtime.getRuntime();
        return rt.totalMemory() - rt.freeMemory();
    }

    /** 用 Error 而非 Exception，确保用户脚本无法用 try/catch 吞掉中断 */
    static final class ScriptAbortError extends Error {
        ScriptAbortError(String message) {
            super(message);
        }
    }

    private static final SandboxFactory FACTORY = new SandboxFactory();

    /** 只允许脚本引擎自身必需的类，其余 Java 类全部拒绝 */
    private static final ClassShutter SHUTTER = fullClassName -> false;

    /** 并发许可：被遗弃的求值不归还许可，用于给失控脚本数量设硬上限 */
    private final Semaphore permits = new Semaphore(MAX_CONCURRENT_EVALUATIONS);
    private final AtomicInteger abandonedCount = new AtomicInteger();

    /**
     * 试运行（用于前端「测试脚本」与保存前校验），不抛异常，返回结构化结果。
     */
    public ScriptResult test(String script, LocalDateTime now, LocalDateTime lastTriggeredAt) {
        return run(script, now, lastTriggeredAt);
    }

    /**
     * 脚本求值结果。
     *
     * @param ok           脚本本身是否正常执行完（语法/返回值/运行期错误均为 false）
     * @param triggered    shouldTrigger 的返回值（仅 ok 为 true 时有意义）
     * @param error        面向用户的错误说明，ok 为 true 时为 null
     * @param unavailable  是否因沙箱自身不可用（并发饱和 / 已出现无法终止的脚本）而失败；
     *                     调用方不应据此停用用户规则，那不是脚本的错
     */
    public record ScriptResult(boolean ok, boolean triggered, String error, boolean unavailable) {

        static ScriptResult ok(boolean triggered) {
            return new ScriptResult(true, triggered, null, false);
        }

        static ScriptResult invalid(String error) {
            return new ScriptResult(false, false, error, false);
        }

        static ScriptResult unavailable(String error) {
            return new ScriptResult(false, false, error, true);
        }
    }

    private ScriptResult run(String script, LocalDateTime now, LocalDateTime lastTriggeredAt) {
        if (script == null || script.isBlank()) {
            return ScriptResult.invalid("脚本内容不能为空");
        }
        if (script.length() > MAX_SCRIPT_LENGTH) {
            return ScriptResult.invalid("脚本过长（上限 " + MAX_SCRIPT_LENGTH + " 字符）");
        }
        // 正则字面量必须在求值前拦掉：它是唯一还能造出正则对象的途径（RegExp 构造器已被桩掉），
        // 而任何正则对象一旦传给 test/exec/replace/split，就会在单次原生调用里无界回溯。
        if (containsRegExpLiteral(script)) {
            return ScriptResult.invalid("脚本中不能使用正则表达式（沙箱不支持 RegExp）");
        }

        // 并发许可：拿不到说明已有脚本没能终止（许可被永久占用），此时拒绝新求值而不是继续泄漏
        if (!permits.tryAcquire()) {
            log.warn("Recurring script rejected: sandbox saturated ({} evaluation(s) never terminated)",
                    abandonedCount.get());
            return ScriptResult.unavailable("脚本沙箱繁忙：已有脚本无法终止，暂不接受新的脚本求值");
        }

        final ScriptResult[] holder = new ScriptResult[1];
        Thread worker = new Thread(() -> holder[0] = doRun(script, now, lastTriggeredAt),
                "recurring-script");
        worker.setDaemon(true);
        worker.start();

        boolean terminated = joinQuietly(worker, TIMEOUT_MS + 500);
        if (terminated) {
            permits.release();
            return holder[0] != null ? holder[0] : ScriptResult.invalid("脚本执行失败");
        }

        // 超时：先尝试打断（对可中断的原生调用有效），仍不退则遗弃线程并永久占用许可
        worker.interrupt();
        terminated = joinQuietly(worker, ABANDON_GRACE_MS);
        if (terminated) {
            permits.release();
            return ScriptResult.invalid("脚本执行超时（上限 " + TIMEOUT_MS + "ms）");
        }

        int total = abandonedCount.incrementAndGet();
        log.error("Recurring script did not terminate and was abandoned ({} total); "
                + "sandbox permits {}/{} still held",
                total, MAX_CONCURRENT_EVALUATIONS - permits.availablePermits(),
                MAX_CONCURRENT_EVALUATIONS);
        return ScriptResult.invalid("脚本执行超时（上限 " + TIMEOUT_MS + "ms）");
    }

    /** 等待线程结束；被中断时同样按「未结束」处理并恢复中断标记 */
    private static boolean joinQuietly(Thread worker, long millis) {
        try {
            worker.join(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return !worker.isAlive();
        }
        return !worker.isAlive();
    }

    private ScriptResult doRun(String script, LocalDateTime now, LocalDateTime lastTriggeredAt) {
        Context cx = FACTORY.enterContext();
        try {
            cx.setClassShutter(SHUTTER);
            cx.setOptimizationLevel(-1);           // 解释模式，指令计数才生效
            cx.setLanguageVersion(Context.VERSION_ES6);
            // 限制调用栈深度，让无限递归在耗尽堆之前就被拦下
            cx.setMaximumInterpreterStackDepth(MAX_STACK_DEPTH);
            Counter counter = new Counter();
            counter.baselineHeap = usedHeap();
            cx.putThreadLocal(Counter.KEY, counter);
            cx.putThreadLocal("startAt", System.currentTimeMillis());

            // initSafeStandardObjects(sealed=false)：不含 JavaAdapter/Packages/getClass 等
            // LiveConnect 桥接（这一点与 sealed 无关），但不密封标准对象 —— 只有不密封，
            // 才能覆写 String.prototype.match/search 与 RegExp.prototype.test/exec。
            // 不密封的代价仅限脚本能改自己的标准对象，它无法借此逃逸到 Java（已实测）。
            ScriptableObject scope = cx.initSafeStandardObjects(null, false);
            neutraliseUnboundedNatives(cx, scope);

            Scriptable ctx = toScriptable(cx, scope, buildContext(now, lastTriggeredAt));
            scope.putConst("ctx", scope, ctx);

            cx.evaluateString(scope, script, "userScript", 1, null);

            Object fn = scope.get(FUNCTION_NAME, scope);
            if (!(fn instanceof org.mozilla.javascript.Function function)) {
                return ScriptResult.invalid(
                        "脚本中必须定义 function " + FUNCTION_NAME + "(ctx) 函数");
            }
            Object out = function.call(cx, scope, scope, new Object[]{ctx});
            if (out == null || out == Context.getUndefinedValue()) {
                return ScriptResult.invalid(
                        FUNCTION_NAME + " 必须返回 true 或 false，当前返回了空值");
            }
            if (!(out instanceof Boolean b)) {
                // 明确要求布尔，避免 "0"/"" 之类的隐式转换造成误触发
                return ScriptResult.invalid(
                        FUNCTION_NAME + " 必须返回布尔值，当前返回类型为 " + describeType(out));
            }
            return ScriptResult.ok(b);
        } catch (ScriptAbortError e) {
            return ScriptResult.invalid(e.getMessage());
        } catch (EvaluatorException e) {
            return ScriptResult.invalid("脚本语法错误：" + e.details()
                    + "（第 " + e.lineNumber() + " 行）");
        } catch (StackOverflowError e) {
            return ScriptResult.invalid("脚本递归层数过深（可能存在无限递归）");
        } catch (OutOfMemoryError e) {
            // 无限递归 / 超大分配可能耗尽堆，必须在工作线程内消化掉，
            // 否则会波及主线程导致整个服务不可用
            return ScriptResult.invalid("脚本占用内存过多，已终止");
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return ScriptResult.invalid("脚本运行出错：" + msg);
        } finally {
            Context.exit();
        }
    }

    /**
     * 顶替一切能把执行带进无界原生代码或动态代码的入口。
     *
     * 已逐项实测（Rhino 1.7.14）：
     * - 顶替全局 {@code RegExp} 后，{@code new RegExp(...)} 抛错，且**正则字面量创建出的对象
     *   会连原型链上的 test/exec 一起失效**（字面量的原型来自全局 RegExp）。
     * - {@code String.prototype.match/search} 传字符串时**不走全局 RegExp**，因此必须单独覆写；
     *   它们所在的原型对象在 sealed=true 时是密封的，这正是这里改用 sealed=false 的原因。
     * - {@code eval}/{@code Function} 顶替后，连 {@code globalThis['eval'](...)} 这类间接调用
     *   也会被拦下；动态代码是绕过源码检查（见 {@link #containsRegExpLiteral}）的唯一途径。
     *
     * 覆写按属性名生效，因此 {@code s['ma'+'tch'](...)} 这种计算属性访问同样被挡住。
     */
    private void neutraliseUnboundedNatives(Context cx, ScriptableObject scope) {
        Object blocked = cx.evaluateString(scope, BLOCKED_STUB_JS, "sandboxInit", 1, null);
        ScriptableObject.putProperty(scope, "RegExp", blocked);
        ScriptableObject.putProperty(scope, "eval", blocked);
        ScriptableObject.putProperty(scope, "Function", blocked);
        overrideOnPrototype(scope, "RegExp", "test", blocked);
        overrideOnPrototype(scope, "RegExp", "exec", blocked);
        overrideOnPrototype(scope, "String", "match", blocked);
        overrideOnPrototype(scope, "String", "search", blocked);
    }

    /** 把某个内建对象原型上的方法替换为桩函数 */
    private void overrideOnPrototype(ScriptableObject scope, String ctorName,
                                     String methodName, Object stub) {
        Object ctor = scope.get(ctorName, scope);
        if (!(ctor instanceof Scriptable ctorScriptable)) {
            return;
        }
        Object proto = ScriptableObject.getProperty(ctorScriptable, "prototype");
        if (proto instanceof Scriptable protoScriptable) {
            ScriptableObject.putProperty(protoScriptable, methodName, stub);
        }
    }

    /**
     * 用 Rhino 自己的解析器判断脚本里是否含正则字面量。
     *
     * 不能用字符扫描代替：{@code /} 同时是除号，注释与字符串里也可能出现斜杠。
     * 解析失败（语法错误）时返回 false，交由求值阶段报出准确的语法错误。
     * 由于 eval/Function 已被桩掉，本检查不存在绕过路径。
     */
    private boolean containsRegExpLiteral(String script) {
        CompilerEnvirons env = new CompilerEnvirons();
        env.setLanguageVersion(Context.VERSION_ES6);
        AstRoot root;
        try {
            root = new Parser(env).parse(script, "userScript", 1);
        } catch (Exception e) {
            return false;
        }
        boolean[] found = {false};
        root.visit(node -> {
            if (node instanceof RegExpLiteral) {
                found[0] = true;
                return false;
            }
            return true;
        });
        return found[0];
    }

    /** 当前是否还有未能终止的脚本线程（供健康检查/测试观察） */
    public boolean isSaturated() {
        return permits.availablePermits() < MAX_CONCURRENT_EVALUATIONS;
    }

    private String describeType(Object out) {
        if (out instanceof Number) return "数字";
        if (out instanceof CharSequence) return "字符串";
        return out.getClass().getSimpleName();
    }

    /**
     * 注入给脚本的上下文变量。只暴露纯数据（数字/字符串/布尔），不暴露任何 Java 对象。
     */
    public static Map<String, Object> buildContext(LocalDateTime now, LocalDateTime lastTriggeredAt) {
        LocalDate date = now.toLocalDate();
        Map<String, Object> map = new HashMap<>();
        map.put("year", date.getYear());
        map.put("month", date.getMonthValue());
        map.put("day", date.getDayOfMonth());
        map.put("dayOfWeek", date.getDayOfWeek().getValue());   // 1=周一 ... 7=周日
        map.put("dayOfYear", date.getDayOfYear());
        map.put("weekOfYear", date.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
        map.put("hour", now.getHour());
        map.put("minute", now.getMinute());
        map.put("daysInMonth", date.lengthOfMonth());
        map.put("isLastDayOfMonth", date.getDayOfMonth() == date.lengthOfMonth());
        map.put("isWeekend", date.getDayOfWeek().getValue() >= 6);
        map.put("dateStr", date.toString());
        if (lastTriggeredAt == null) {
            map.put("daysSinceLastTrigger", -1);
            map.put("hoursSinceLastTrigger", -1);
            map.put("neverTriggered", true);
        } else {
            map.put("daysSinceLastTrigger",
                    (int) ChronoUnit.DAYS.between(lastTriggeredAt.toLocalDate(), date));
            map.put("hoursSinceLastTrigger",
                    (int) ChronoUnit.HOURS.between(lastTriggeredAt, now));
            map.put("neverTriggered", false);
        }
        return map;
    }

    private Scriptable toScriptable(Context cx, Scriptable scope, Map<String, Object> data) {
        Scriptable obj = cx.newObject(scope);
        data.forEach((k, v) -> ScriptableObject.putProperty(obj, k, v));
        return obj;
    }

    /** 给前端的函数骨架模板 */
    public static final String SCRIPT_TEMPLATE = """
            // 返回 true 表示此刻应该触发，生成一条待办
            // 系统每分钟检查一次；同一分钟内只会触发一次
            // 沙箱内不可使用正则表达式，也不可使用 eval / Function
            function shouldTrigger(ctx) {
              // 可用字段：
              //   ctx.year / ctx.month / ctx.day
              //   ctx.dayOfWeek        1=周一 ... 7=周日
              //   ctx.hour / ctx.minute
              //   ctx.weekOfYear       ISO 周序号（注意：不是学期教学周）
              //   ctx.dayOfYear / ctx.daysInMonth
              //   ctx.isLastDayOfMonth / ctx.isWeekend
              //   ctx.daysSinceLastTrigger   距上次触发天数（从未触发为 -1）
              //   ctx.neverTriggered

              // 示例：每周五 12:00
              return ctx.dayOfWeek === 5
                  && ctx.hour === 12
                  && ctx.minute === 0;
            }
            """;
}
