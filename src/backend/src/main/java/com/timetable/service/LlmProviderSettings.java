package com.timetable.service;

import com.timetable.config.LlmProperties;
import com.timetable.config.LlmProviderConfig;
import com.timetable.config.LocalSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * provider 配置的「本地设置 → 运行时视图」（成本治理 6.1 #2：界面里配 provider）。
 *
 * <p>背景：{@code app.llm.providers.*} 只能改 yml 或环境变量，桌面单机版用户根本没有
 * 运维去改这些。于是把界面填的值落在 {@link LocalSettings}（数据目录下的
 * {@code settings.properties}，Key 加密存放），运行时与配置文件合并。
 *
 * <p>优先级：<b>本地设置 &gt; application.yml / 环境变量</b>。这个方向刻意与直觉相反地
 * 选成「界面赢」——用户既然在界面上填了，就说明他想覆盖部署默认值；反过来会出现
 * 「我明明填了 Key 为什么还用旧的」这种最难排查的问题。
 *
 * <p>字段级覆盖而不是整体替换：本地只填了 Key、没填模型名时，模型名仍从 yml 取。
 * 覆盖粒度到字段，用户不用把整个 provider 抄一遍。
 *
 * <p>线程安全：{@link #snapshot()} 每次返回新对象，registry 靠对象身份变化判断要不要
 * 重建客户端，所以这里不需要额外加锁——{@link LocalSettings} 自身已同步。
 */
@Component
public class LlmProviderSettings {

    private static final Logger log = LoggerFactory.getLogger(LlmProviderSettings.class);

    /** 本地设置里 provider 的键前缀：{@code llm.provider.<id>.<field>} */
    static final String PREFIX = "llm.provider.";
    static final String SUFFIX_BASE_URL = ".base-url";
    static final String SUFFIX_MODEL = ".model";
    static final String SUFFIX_API_KEY = ".api-key";
    static final String SUFFIX_TIMEOUT = ".timeout-seconds";
    static final String SUFFIX_MAX_TOKENS = ".max-tokens";
    static final String SUFFIX_TEMPERATURE = ".temperature";

    /** providerId 会进键名，必须限制字符集（防注入奇怪键，也让 settings.properties 可读） */
    private static final Pattern VALID_ID = Pattern.compile("^[a-z0-9][a-z0-9_-]{0,31}$");

    private final LlmProperties properties;
    private final LocalSettings settings;
    private final boolean localSettingsEnabled;

    public LlmProviderSettings(LlmProperties properties, LocalSettings settings,
                               @org.springframework.beans.factory.annotation.Value(
                                       "${app.security.allow-local-ai-key-settings:false}")
                               boolean localSettingsEnabled) {
        this.properties = properties;
        this.settings = settings;
        this.localSettingsEnabled = localSettingsEnabled;
    }

    /** 界面配置是否可用（服务器部署由环境变量管理，不给改） */
    public boolean isEditable() {
        return localSettingsEnabled;
    }

    /**
     * 合并后的运行时视图。配置没变时内容相同但对象不同——registry 用
     * {@link #version()} 而不是对象引用判断，避免每次请求都重建客户端。
     */
    public Map<String, LlmProviderConfig> snapshot() {
        Map<String, LlmProviderConfig> merged = new LinkedHashMap<>();
        for (Map.Entry<String, LlmProviderConfig> entry : properties.getProviders().entrySet()) {
            merged.put(normalizeId(entry.getKey()), copy(entry.getValue()));
        }
        if (!localSettingsEnabled) {
            return merged;
        }
        for (String id : localProviderIds()) {
            LlmProviderConfig local = readLocal(id);
            LlmProviderConfig base = merged.get(id);
            merged.put(id, base == null ? local : overlay(base, local));
        }
        return merged;
    }

    /**
     * 配置版本号：值的指纹。registry 拿它和上次比较，变了就重建动态客户端。
     *
     * <p>Key 用 SHA-256 前 8 字节参与计算，**不能只放长度**：`sk-1` 和 `sk-2` 长度相同，
     * 只算长度的话用户换了 Key 不会触发重建，会一直用旧 Key 而不报错——这种「改配置没生效」
     * 是最难排查的一类问题（本功能第一版就是这么写的，被测试抓住了）。
     * 摘要不可逆且只留 8 字节，不构成泄漏面。
     */
    public String version() {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, LlmProviderConfig> entry : snapshot().entrySet()) {
            LlmProviderConfig c = entry.getValue();
            sb.append(entry.getKey()).append('|')
                    .append(c.getBaseUrl()).append('|')
                    .append(c.getModel()).append('|')
                    .append(keyFingerprint(c.getApiKey())).append('|')
                    .append(c.getTimeoutSeconds()).append('|')
                    .append(c.getMaxTokens()).append('|')
                    .append(c.getTemperature()).append('\n');
        }
        return sha256Hex(sb.toString()).substring(0, 16);
    }

    private static String keyFingerprint(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return "-";
        }
        return sha256Hex(apiKey).substring(0, 16);
    }

    private static String sha256Hex(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 8 && i < digest.length; i++) {
                hex.append(String.format("%02x", digest[i]));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            // SHA-256 是 JDK 必备算法，走不到这里
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    /** 本地设置里出现过的 providerId（去重、已规范化）。 */
    public Set<String> localProviderIds() {
        Set<String> ids = new java.util.LinkedHashSet<>();
        if (!localSettingsEnabled) {
            return ids;
        }
        for (String name : settings.names()) {
            if (!name.startsWith(PREFIX)) {
                continue;
            }
            int dot = name.indexOf('.', PREFIX.length());
            if (dot > PREFIX.length()) {
                ids.add(name.substring(PREFIX.length(), dot));
            }
        }
        ids.removeIf(id -> !VALID_ID.matcher(id).matches());
        return ids;
    }

    /** 单个 provider 的本地覆盖值（可能为空字段）。 */
    public LlmProviderConfig readLocal(String providerId) {
        LlmProviderConfig config = new LlmProviderConfig();
        config.setBaseUrl(orEmpty(settings.get(key(providerId, SUFFIX_BASE_URL))));
        config.setModel(orEmpty(settings.get(key(providerId, SUFFIX_MODEL))));
        config.setApiKey(orEmpty(settings.get(key(providerId, SUFFIX_API_KEY))));
        config.setTimeoutSeconds(intOr(settings.get(key(providerId, SUFFIX_TIMEOUT)),
                config.getTimeoutSeconds()));
        config.setMaxTokens(intOr(settings.get(key(providerId, SUFFIX_MAX_TOKENS)),
                config.getMaxTokens()));
        config.setTemperature(doubleOr(settings.get(key(providerId, SUFFIX_TEMPERATURE)),
                config.getTemperature()));
        return config;
    }

    /**
     * 保存一个 provider 的本地配置。
     *
     * @param apiKey 传 null 表示「不改动现有 Key」（界面上 Key 只显示掩码，用户没重填时不能清空）；
     *               传空串表示显式清除。
     */
    public void save(String providerId, String baseUrl, String model, String apiKey,
                     Integer timeoutSeconds, Integer maxTokens, Double temperature) {
        requireEditable();
        String id = requireValidId(providerId);
        // 先把能校验的都校验完，再动磁盘：避免写了一半失败，留下半套配置
        if (apiKey != null && !apiKey.isBlank() && !canStoreSecret()) {
            throw new com.timetable.exception.BusinessException(500,
                    "本机未启用密钥加密保护，无法保存 API Key。"
                            + "桌面版请通过桌面外壳启动；自行部署请设置 TANGENT_SETTINGS_ENCRYPTION_KEY");
        }
        settings.set(key(id, SUFFIX_BASE_URL), baseUrl);
        settings.set(key(id, SUFFIX_MODEL), model);
        if (apiKey != null) {
            settings.set(key(id, SUFFIX_API_KEY), apiKey);
        }
        settings.set(key(id, SUFFIX_TIMEOUT), timeoutSeconds == null ? null : timeoutSeconds.toString());
        settings.set(key(id, SUFFIX_MAX_TOKENS), maxTokens == null ? null : maxTokens.toString());
        settings.set(key(id, SUFFIX_TEMPERATURE), temperature == null ? null : temperature.toString());
        log.info("provider {} 的本地配置已更新（Key {}）", id, apiKey == null ? "未改动" : "已更新");
    }

    /** 本机是否具备加密保存 Key 的能力。 */
    public boolean canStoreSecret() {
        return settings.canStoreSecret();
    }

    /** 删除本地覆盖，回退到 yml/环境变量。 */
    public void clear(String providerId) {
        requireEditable();
        String id = requireValidId(providerId);
        for (String suffix : new String[]{SUFFIX_BASE_URL, SUFFIX_MODEL, SUFFIX_API_KEY,
                SUFFIX_TIMEOUT, SUFFIX_MAX_TOKENS, SUFFIX_TEMPERATURE}) {
            settings.set(key(id, suffix), null);
        }
        log.info("provider {} 的本地配置已清除", id);
    }

    /** Key 的掩码形式，绝不返回完整 Key。 */
    public static String mask(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return "";
        }
        String key = apiKey.trim();
        if (key.length() <= 8) {
            return "****";
        }
        return key.substring(0, 4) + "****" + key.substring(key.length() - 4);
    }

    public static boolean isValidId(String providerId) {
        return providerId != null && VALID_ID.matcher(providerId).matches();
    }

    // ==================== 内部 ====================

    private String requireValidId(String providerId) {
        String id = normalizeId(providerId);
        if (!isValidId(id)) {
            // id 会进键名，也进 URL 路径，必须收紧
            throw new com.timetable.exception.BusinessException(400,
                    "provider 标识只能用小写字母、数字、下划线和连字符，且不超过 32 个字符");
        }
        return id;
    }

    private void requireEditable() {
        if (!localSettingsEnabled) {
            throw new com.timetable.exception.BusinessException(403, "服务器 AI 服务配置由部署环境管理");
        }
    }

    private static String normalizeId(String providerId) {
        return providerId == null ? "" : providerId.trim().toLowerCase(java.util.Locale.ROOT);
    }

    private static String key(String providerId, String suffix) {
        return PREFIX + providerId + suffix;
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    private static int intOr(String value, int fallback) {
        try {
            return value == null || value.isBlank() ? fallback : Integer.parseInt(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static double doubleOr(String value, double fallback) {
        try {
            return value == null || value.isBlank() ? fallback : Double.parseDouble(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static LlmProviderConfig copy(LlmProviderConfig source) {
        LlmProviderConfig target = new LlmProviderConfig();
        target.setBaseUrl(source.getBaseUrl());
        target.setModel(source.getModel());
        target.setApiKey(source.getApiKey());
        target.setTimeoutSeconds(source.getTimeoutSeconds());
        target.setIdleTimeoutSeconds(source.getIdleTimeoutSeconds());
        target.setMaxTokens(source.getMaxTokens());
        target.setTemperature(source.getTemperature());
        target.setReasoningEffort(source.getReasoningEffort());
        return target;
    }

    /** 字段级覆盖：本地为空则保留配置文件的值。 */
    private static LlmProviderConfig overlay(LlmProviderConfig base, LlmProviderConfig local) {
        LlmProviderConfig result = copy(base);
        if (local.getBaseUrl() != null && !local.getBaseUrl().isBlank()) {
            result.setBaseUrl(local.getBaseUrl());
        }
        if (local.getModel() != null && !local.getModel().isBlank()) {
            result.setModel(local.getModel());
        }
        if (local.getApiKey() != null && !local.getApiKey().isBlank()) {
            result.setApiKey(local.getApiKey());
        }
        result.setTimeoutSeconds(local.getTimeoutSeconds());
        result.setMaxTokens(local.getMaxTokens());
        result.setTemperature(local.getTemperature());
        return result;
    }
}
