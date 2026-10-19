package com.timetable.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 存活探针。
 *
 * <p>为什么专门做一个：容器平台（Docker HEALTHCHECK、k8s liveness、Railway/Render 的健康检查）
 * 都需要一个「不带凭据」的地址来判断这个进程还能不能干活。原来的所有 /api/** 都要 X-API-Key，
 * 探针没法带，只能把整站首页当信号——但首页是静态资源，数据库挂了它照样 200，
 * 于是「进程活着」被误当成「服务可用」，用户点进去才开始报错。
 *
 * <p>这里只回答一件事：数据库还连得上吗。只输出 up/down，不吐版本号、连接串、耗时、
 * 异常堆栈——探针是公开地址，这些都属于给攻击者的情报。
 */
@RestController
@RequestMapping("/api/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final DataSource dataSource;

    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /**
     * 不需要鉴权（已在 WebMvcConfig 豁免）。
     *
     * <p>数据库不通时返回 503 而不是 200 + {"status":"down"}：健康检查工具大多只看状态码，
     * 200 里面写 down 等于没说。
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        boolean dbUp = pingDatabase();

        body.put("status", dbUp ? "up" : "down");
        body.put("db", dbUp ? "up" : "down");

        if (dbUp) {
            return ResponseEntity.ok(body);
        }
        // 真正的异常细节进日志，不进响应体——探针是对外公开的。
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
    }

    private boolean pingDatabase() {
        try (Connection connection = dataSource.getConnection()) {
            // 只验证连接可获取且仍然有效；不跑业务 SQL，避免探针本身给库加压。
            return connection.isValid(2);
        } catch (Exception e) {
            log.warn("健康检查：数据库连接不可用 - {}", e.getMessage());
            return false;
        }
    }
}
