package com.timetable.service.impl;

import com.timetable.config.DeepSeekProperties;
import com.timetable.config.LocalSettings;
import org.springframework.stereotype.Component;

/**
 * DeepSeek Key 的取值来源。
 *
 * <p>优先级：本地设置（桌面版在界面里填、存在数据目录）→ 配置项（环境变量 / application.yml）。
 *
 * <p>桌面版没有运维去设环境变量，所以必须允许用户自己在界面上填 Key；而服务器部署仍然可以
 * 只用环境变量，两种方式共存且互不干扰。
 */
@Component
public class DeepSeekKeyStore {

    /** 本地设置里保存 Key 的键名 */
    static final String SETTING_KEY = "deepseek.api-key";
    /** application.yml 里的占位默认值，等同于「未配置」 */
    private static final String PLACEHOLDER = "your-deepseek-api-key";

    private final DeepSeekProperties properties;
    private final LocalSettings settings;

    public DeepSeekKeyStore(DeepSeekProperties properties, LocalSettings settings) {
        this.properties = properties;
        this.settings = settings;
    }

    /** 当前生效的 Key（可能为空字符串） */
    public String effectiveKey() {
        String local = settings.get(SETTING_KEY);
        if (local != null && !local.isBlank()) {
            return local.trim();
        }
        String configured = properties.getKey();
        return configured == null ? "" : configured.trim();
    }

    public boolean isConfigured() {
        String key = effectiveKey();
        return !key.isBlank() && !PLACEHOLDER.equals(key);
    }

    /** 取值来源：{@code local}（界面填入）/ {@code config}（环境变量或配置文件）/ {@code none} */
    public String source() {
        String local = settings.get(SETTING_KEY);
        if (local != null && !local.isBlank()) {
            return "local";
        }
        return isConfigured() ? "config" : "none";
    }

    /** 供界面展示的掩码形式，绝不返回完整 Key；未配置时返回空串 */
    public String masked() {
        // 未配置时不能掩码占位默认值，否则界面上会显示成「已配置了 your****-key」
        if (!isConfigured()) {
            return "";
        }
        String key = effectiveKey();
        if (key.length() <= 8) {
            return "****";
        }
        return key.substring(0, 4) + "****" + key.substring(key.length() - 4);
    }

    public void save(String key) {
        settings.set(SETTING_KEY, key);
    }

    public void clear() {
        settings.set(SETTING_KEY, null);
    }
}
