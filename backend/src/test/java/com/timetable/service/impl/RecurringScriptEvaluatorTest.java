package com.timetable.service.impl;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 沙箱脚本执行器的安全与行为测试。
 * 重点验证：正常脚本可用、非布尔返回值被拒、以及危险脚本被安全终止而非拖垮进程。
 */
class RecurringScriptEvaluatorTest {

    private final RecurringScriptEvaluator evaluator = new RecurringScriptEvaluator();

    /** 2026-09-28 是周一 */
    private final LocalDateTime monday = LocalDateTime.of(2026, 9, 28, 10, 0);

    private RecurringScriptEvaluator.ScriptResult run(String script) {
        return evaluator.test(script, monday, null);
    }

    @Test
    void validScriptCanTrigger() {
        var result = run("function shouldTrigger(ctx){ return ctx.dayOfWeek === 1; }");
        assertTrue(result.ok());
        assertTrue(result.triggered());
    }

    @Test
    void validScriptCanDecline() {
        var result = run("function shouldTrigger(ctx){ return ctx.dayOfWeek === 5; }");
        assertTrue(result.ok());
        assertFalse(result.triggered());
    }

    @Test
    void nonBooleanReturnIsRejected() {
        var result = run("function shouldTrigger(ctx){ return 1; }");
        assertFalse(result.ok());
        assertFalse(result.triggered());
    }

    @Test
    void missingFunctionIsRejected() {
        var result = run("var x = 1;");
        assertFalse(result.ok());
    }

    @Test
    void syntaxErrorIsRejected() {
        var result = run("function shouldTrigger(ctx) { return true; ");
        assertFalse(result.ok());
    }

    @Test
    void oversizedScriptIsRejected() {
        String script = "function shouldTrigger(ctx){ return true; }" + "0".repeat(5000);
        var result = run(script);
        assertFalse(result.ok());
    }

    @Test
    void javaAccessIsBlocked() {
        var result = run("function shouldTrigger(ctx){ return java.lang.Runtime !== null; }");
        assertFalse(result.ok());
    }

    @Test
    void infiniteLoopIsAborted() {
        var result = run("function shouldTrigger(ctx){ while(true){} }");
        assertFalse(result.ok());
    }

    @Test
    void infiniteRecursionIsAborted() {
        var result = run("function shouldTrigger(ctx){ return shouldTrigger(ctx); }");
        assertFalse(result.ok());
    }

    /**
     * 回归用例：修复前这个脚本会在一次原生正则调用里无限回溯，墙钟检查只写在指令观察器里，
     * 而原生调用根本不经过指令边界 —— 于是 test() 超时返回，工作线程却永不结束，
     * 每次请求泄漏一个占满 CPU 的线程。现在正则字面量在求值前就被拒绝。
     */
    @Test
    void catastrophicRegexIsRejectedBeforeEvaluation() {
        long start = System.currentTimeMillis();
        var result = run("function shouldTrigger(ctx){"
                + " var s = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!';"
                + " return /(a+)+$/.test(s); }");
        long elapsed = System.currentTimeMillis() - start;
        assertFalse(result.ok());
        assertFalse(result.unavailable());
        assertTrue(elapsed < 1000, "应求值前即被拒绝，实测耗时 " + elapsed + "ms");
    }

    /** 正则字面量是唯一还能造出正则对象的途径，必须从源码层拦死 */
    @Test
    void regexLiteralIsRejected() {
        assertFalse(run("function shouldTrigger(ctx){ return /x/.test('x'); }").ok());
        assertFalse(run("function shouldTrigger(ctx){ var r = /abc/gi; return r.source.length > 0; }").ok());
    }

    /** 构造器入口：即使绕过源码检查，运行时也被桩函数挡下 */
    @Test
    void regExpConstructorIsBlocked() {
        assertFalse(run("function shouldTrigger(ctx){ return new RegExp('a').test('a'); }").ok());
    }

    /**
     * match/search 传字符串时不走全局 RegExp，是仅有的、能穿透指令计数的另一条路径，
     * 因此必须单独覆写 String.prototype（这也是改用非密封标准对象的原因）。
     */
    @Test
    void stringMatchAndSearchCannotReachTheRegexEngine() {
        assertFalse(run("function shouldTrigger(ctx){ return 'aaa'.match('a+') !== null; }").ok());
        assertFalse(run("function shouldTrigger(ctx){ return 'aaa'.search('a+') >= 0; }").ok());
        // 计算属性访问也绕不过去：覆写是按属性名生效的
        assertFalse(run("function shouldTrigger(ctx){ return 'aaa'['ma'+'tch']('a+') !== null; }").ok());
    }

    /** 动态代码是绕过源码检查的唯一途径，必须关闭（含间接调用） */
    @Test
    void dynamicCodeIsBlocked() {
        assertFalse(run("function shouldTrigger(ctx){ return eval('1') === 1; }").ok());
        assertFalse(run("function shouldTrigger(ctx){ return Function('return 1')() === 1; }").ok());
        assertFalse(run("function shouldTrigger(ctx){ return globalThis['eval']('1') === 1; }").ok());
    }

    /** 关闭正则不能误伤日常字符串操作 */
    @Test
    void plainStringAndMathOperationsStillWork() {
        assertTrue(run("function shouldTrigger(ctx){ return ctx.dateStr.split('-').length === 3; }").triggered());
        assertTrue(run("function shouldTrigger(ctx){ return ctx.dateStr.replace('-', '/').length > 0; }").triggered());
        assertTrue(run("function shouldTrigger(ctx){ return Math.floor(ctx.daysInMonth / 2) >= 14; }").triggered());
        assertTrue(run("function shouldTrigger(ctx){ return ctx.dateStr.indexOf('-') === 4; }").triggered());
    }
}
