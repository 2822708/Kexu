package com.timetable.config;

import com.timetable.entity.ApiKey;
import com.timetable.mapper.ApiKeyMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.HexFormat;

/**
 * 首次启动引导：{@code api_key} 表为空时创建一个管理员账号。
 *
 * 应用没有注册页与账号管理接口，账号只能由部署者预先写入数据库。若什么都不做，
 * 全新部署会连一个能登录的账号都没有，因此这里在表为空时补一个：
 * 优先使用配置项（环境变量 {@code TANGENT_BOOTSTRAP_KEY}），否则生成随机 Key 并打印到日志。
 *
 * <p>刻意不再内置任何固定 Key —— 公开仓库里的固定 Key 等于公开凭据；随机 Key 只在
 * 创建的那一次输出，之后不再打印。运维应把它换成一个自己保管的值（见 docs/DEPLOYMENT.md）。
 */
@Component
public class ApiKeyBootstrap {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyBootstrap.class);

    /** 随机 Key 的字节数（32 字节 → 64 个十六进制字符，正好等于 api_key 列宽） */
    private static final int RANDOM_KEY_BYTES = 32;

    private final ApiKeyMapper apiKeyMapper;
    private final String configuredKey;

    public ApiKeyBootstrap(ApiKeyMapper apiKeyMapper,
                           @Value("${app.bootstrap-key:}") String configuredKey) {
        this.apiKeyMapper = apiKeyMapper;
        this.configuredKey = configuredKey;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void createFirstKeyIfEmpty() {
        try {
            Long existing = apiKeyMapper.selectCount(null);
            if (existing != null && existing > 0) {
                return;
            }
            String key = configuredKey == null || configuredKey.isBlank()
                    ? randomKey()
                    : configuredKey.trim();
            ApiKey account = new ApiKey();
            account.setApiKey(key);
            account.setLabel("管理员");
            apiKeyMapper.insert(account);
            log.warn("======================================================================");
            log.warn(" 未发现任何 API Key，已创建首个账号（label=管理员）");
            log.warn(" 登录用 Key：{}", key);
            log.warn(" 该 Key 只在此处输出一次，请立即妥善保存；如非本意，请在启动前设置");
            log.warn(" TANGENT_BOOTSTRAP_KEY 指定自己的 Key。");
            log.warn("======================================================================");
        } catch (DuplicateKeyException e) {
            // 并发启动（多实例）时另一个实例已创建，忽略
            log.info("First API key already created by another instance");
        } catch (Exception e) {
            // 引导失败不应阻止应用启动，但要明确记录
            log.error("Failed to bootstrap the first API key", e);
        }
    }

    private String randomKey() {
        byte[] bytes = new byte[RANDOM_KEY_BYTES];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
