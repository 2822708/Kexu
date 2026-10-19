package com.timetable.controller;

import com.timetable.config.LlmProperties;
import com.timetable.config.LlmProviderConfig;
import com.timetable.dto.ApiResponse;
import com.timetable.dto.LlmProviderRequest;
import com.timetable.exception.BusinessException;
import com.timetable.interceptor.RequestContext;
import com.timetable.security.AdminAuthorizationService;
import com.timetable.service.LlmClientRegistry;
import com.timetable.service.LlmProviderSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * LLM provider 的界面配置（成本治理 6.1 #2）。
 *
 * <p>为什么需要它：{@code app.llm.providers.*} 只能改 yml 或环境变量，而桌面单机版
 * 用户没有运维去改这些——注册了 provider 却配不上，等于功能不存在。
 *
 * <p>权限与既有的 {@code /api/ai/config} 完全一致：ADMIN + 仅当
 * {@code app.security.allow-local-ai-key-settings=true}（桌面版）才可写。服务器部署下
 * 读接口仍可用（便于排查），写接口一律 403。
 *
 * <p>安全要点：响应里<b>只出现掩码 Key</b>，完整 Key 既不回显也不进日志。
 */
@RestController
@RequestMapping("/api/ai/providers")
public class LlmProviderController {

    private static final Logger log = LoggerFactory.getLogger(LlmProviderController.class);

    /** base-url 只允许 http/https，防止填成 file:// 或 jdbc: 之类的协议被 HttpClient 拒到难懂的错误 */
    private static final int MAX_ID_LENGTH = 32;

    private final LlmProviderSettings providerSettings;
    private final LlmClientRegistry registry;
    private final LlmProperties llmProperties;
    private final AdminAuthorizationService adminAuthorizationService;

    public LlmProviderController(LlmProviderSettings providerSettings, LlmClientRegistry registry,
                                 LlmProperties llmProperties,
                                 AdminAuthorizationService adminAuthorizationService) {
        this.providerSettings = providerSettings;
        this.registry = registry;
        this.llmProperties = llmProperties;
        this.adminAuthorizationService = adminAuthorizationService;
    }

    /**
     * 列出所有 provider：配置文件里的 + 界面里配的，合并后的最终值。
     *
     * <p>{@code source} 说明这个 provider 从哪来，是排查「我配的为什么没生效」的第一手信息：
     * {@code local}（界面）、{@code config}（yml/环境变量）、{@code both}（两者都有，界面赢）。
     */
    @GetMapping
    public ApiResponse<Map<String, Object>> list() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("editable", providerSettings.isEditable());

        List<Map<String, Object>> providers = new ArrayList<>();
        Map<String, LlmProviderConfig> merged = providerSettings.snapshot();
        java.util.Set<String> local = providerSettings.localProviderIds();
        java.util.Set<String> fromConfig = llmProperties.getProviders().keySet();

        for (Map.Entry<String, LlmProviderConfig> entry : merged.entrySet()) {
            String id = entry.getKey();
            LlmProviderConfig config = entry.getValue();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", id);
            item.put("baseUrl", config.getBaseUrl());
            item.put("model", config.getModel());
            item.put("keyMasked", LlmProviderSettings.mask(config.getApiKey()));
            item.put("configured", config.isComplete());
            item.put("timeoutSeconds", config.getTimeoutSeconds());
            item.put("maxTokens", config.getMaxTokens());
            item.put("temperature", config.getTemperature());
            item.put("source", describeSource(local.contains(id), fromConfig.contains(id)));
            providers.add(item);
        }

        data.put("providers", providers);
        data.put("activeProvider", llmProperties.getActiveProvider());
        data.put("routes", llmProperties.getRoutes() == null ? Map.of() : llmProperties.getRoutes());
        data.put("fallback", llmProperties.getFallback() == null ? List.of() : llmProperties.getFallback());
        // 当前真正可用的 providerId，便于用户确认「填完了是不是生效了」
        data.put("ready", readyProviders());
        return ApiResponse.success(data);
    }

    /** 新增或更新一个 provider。{@code apiKey} 传 null 表示不改动现有 Key。 */
    @PutMapping
    public ApiResponse<Map<String, Object>> save(@RequestBody LlmProviderRequest request) {
        requireAdmin();
        requireLocalSettings();
        if (request == null || request.getId() == null || request.getId().isBlank()) {
            throw new BusinessException(400, "provider 标识不能为空");
        }
        String id = request.getId().trim().toLowerCase(java.util.Locale.ROOT);
        if (id.length() > MAX_ID_LENGTH || !LlmProviderSettings.isValidId(id)) {
            throw new BusinessException(400,
                    "provider 标识只能用小写字母、数字、下划线和连字符，且不超过 32 个字符");
        }
        if (LlmClientRegistry.DEEPSEEK.equals(id)) {
            // deepseek 走既有 deepseek.api.* 与本机 Key 设置，从这里改会出现两个入口互相打架
            throw new BusinessException(400, "deepseek 请在「AI 助手」卡片中配置，这里用于新增其它 OpenAI 兼容服务");
        }
        String baseUrl = request.getBaseUrl() == null ? "" : request.getBaseUrl().trim();
        if (!baseUrl.isEmpty()) {
            validateBaseUrl(baseUrl);
        }
        if (request.getMaxTokens() != null && (request.getMaxTokens() < 256 || request.getMaxTokens() > 32768)) {
            throw new BusinessException(400, "max-tokens 需在 256–32768 之间");
        }
        if (request.getTimeoutSeconds() != null
                && (request.getTimeoutSeconds() < 5 || request.getTimeoutSeconds() > 600)) {
            throw new BusinessException(400, "timeout-seconds 需在 5–600 之间");
        }
        if (request.getTemperature() != null
                && (request.getTemperature() < 0 || request.getTemperature() > 2)) {
            throw new BusinessException(400, "temperature 需在 0–2 之间");
        }
        String apiKey = request.getApiKey();
        if (apiKey != null && !apiKey.isEmpty()) {
            apiKey = apiKey.trim();
            if (apiKey.length() < 8 || apiKey.length() > 200) {
                throw new BusinessException(400, "API Key 长度不合法");
            }
        }

        providerSettings.save(id, baseUrl, request.getModel(), apiKey,
                request.getTimeoutSeconds(), request.getMaxTokens(), request.getTemperature());
        log.info("provider {} 已保存（ready={}）", id, readyProviders());
        return list();
    }

    /** 删除界面里的 provider 配置，回退到 yml/环境变量。 */
    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, Object>> remove(@PathVariable String id) {
        requireAdmin();
        requireLocalSettings();
        providerSettings.clear(id);
        log.info("provider {} 的本地配置已删除（ready={}）", id, readyProviders());
        return list();
    }

    // ==================== 辅助 ====================

    private List<String> readyProviders() {
        List<String> ready = new ArrayList<>();
        for (Map.Entry<String, LlmProviderConfig> entry : providerSettings.snapshot().entrySet()) {
            if (entry.getValue().isComplete()) {
                ready.add(entry.getKey());
            }
        }
        // 内置 deepseek 的 Key 来源在 DeepSeekKeyStore，不在 provider 配置里
        return ready;
    }

    private String describeSource(boolean local, boolean config) {
        if (local && config) {
            return "both";
        }
        return local ? "local" : "config";
    }

    private void validateBaseUrl(String baseUrl) {
        URI uri;
        try {
            uri = URI.create(baseUrl);
        } catch (IllegalArgumentException e) {
            throw new BusinessException(400, "服务地址格式不正确");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new BusinessException(400, "服务地址必须以 http:// 或 https:// 开头");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new BusinessException(400, "服务地址缺少主机名");
        }
    }

    private void requireAdmin() {
        adminAuthorizationService.requireAdmin(RequestContext.getApiKey());
    }

    private void requireLocalSettings() {
        if (!providerSettings.isEditable()) {
            throw new BusinessException(403, "服务器 AI 服务配置由部署环境管理");
        }
    }
}
