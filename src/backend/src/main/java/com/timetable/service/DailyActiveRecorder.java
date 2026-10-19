package com.timetable.service;

import com.timetable.entity.AiEvent;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.LocalDate;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 每日活跃埋点（成本治理 6.1 #1 的留存口径）。
 *
 * <h2>为什么需要这个类而不是直接在拦截器里写事件</h2>
 *
 * <p>拦截器每个请求都会跑。一个页面打开就是十几个请求，直接写的话 {@code ai_event}
 * 会被同一个人的同一天刷出几千条，表迅速膨胀，而留存看的是「这个人今天来过没有」——
 * 一条就够。
 *
 * <h2>去重策略：进程内按天</h2>
 *
 * <p>用 {@code Set<String>} 记住「今天已经记过的 apiKey」，命中就直接返回，不碰数据库。
 * 这是本项目单机部署下的合理取舍：重启后内存清空，会多写一条当天的事件，
 * 对留存统计毫无影响（那边按 {@code DISTINCT DATE} 算，多条也是一天）。
 *
 * <p>刻意<b>不做</b>「先查库看有没有」：那等于每个请求多一次 SELECT，
 * 为了省一条冗余记录把主链路拖慢，不划算。
 */
@Service
public class DailyActiveRecorder {

    private final AiEventRecorder eventRecorder;
    private final Clock clock;

    /** 已记录过活跃的「日期@apiKey」。只在内存里，进程重启即清空。 */
    private final Set<String> recorded = ConcurrentHashMap.newKeySet();
    /** 当前缓存的日期；跨天人一换就把整个集合清掉，不让它无限长大。 */
    private volatile LocalDate currentDay;

    public DailyActiveRecorder(AiEventRecorder eventRecorder, Clock clock) {
        this.eventRecorder = eventRecorder;
        this.clock = clock;
    }

    /** 记一次活跃；同一天重复调用直接返回，不产生任何 IO。 */
    public void touch(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return;
        }
        LocalDate today = LocalDate.now(clock);
        // 跨天：先清集合再继续。用 synchronized 块保护「换天 + 加入」这一对操作，
        // 否则两个线程可能一个用旧集合一个用新集合，旧集合里那条记录就白记了。
        synchronized (this) {
            if (currentDay == null || !currentDay.equals(today)) {
                recorded.clear();
                currentDay = today;
            }
            if (!recorded.add(today + "@" + apiKey)) {
                return;
            }
        }
        eventRecorder.record(apiKey, AiEvent.TYPE_APP_ACTIVE, null, null, null);
    }

    /** 测试用：清空内存状态，避免用例之间互相影响。 */
    void resetForTest() {
        synchronized (this) {
            recorded.clear();
            currentDay = null;
        }
    }
}
