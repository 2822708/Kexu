package com.timetable.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timetable.config.LlmProperties;
import com.timetable.config.LlmProviderConfig;
import com.timetable.config.LocalSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 界面配置 provider 的两个关键语义（成本治理 6.1 #2）。
 *
 * <ol>
 *   <li><b>本地覆盖 yml</b>：界面填的值赢过配置文件，且是字段级覆盖——只填 Key 时
 *       模型名仍从 yml 取，用户不用把整个 provider 抄一遍。</li>
 *   <li><b>热生效</b>：保存后不重启就换掉客户端。这条是「桌面版没有运维」的前提，
 *       做不到的话功能等于没做。</li>
 * </ol>
 */
class LlmProviderSettingsTest {

    private static final String MASTER_KEY = "unit-test-master-key";

    @TempDir
    Path dataDir;

    @Test
    void localSettingsOverrideYmlFieldByField() {
        LlmProperties properties = new LlmProperties();
        LlmProviderConfig yml = new LlmProviderConfig();
        yml.setBaseUrl("https://yml.example.com/v4");
        yml.setModel("glm-4-flash");
        yml.setApiKey("yml-key");
        properties.getProviders().put("glm", yml);

        LlmProviderSettings settings = settings(properties, true);
        // 界面上只改了 Key
        settings.save("glm", "", "", "local-key", null, null, null);

        LlmProviderConfig merged = settings.snapshot().get("glm");
        assertThat(merged.getApiKey()).isEqualTo("local-key");
        assertThat(merged.getBaseUrl())
                .as("本地没填的字段要继续用 yml 的值，不能变成空")
                .isEqualTo("https://yml.example.com/v4");
        assertThat(merged.getModel()).isEqualTo("glm-4-flash");
    }

    @Test
    void localProviderCanBeAddedWithoutTouchingYml() {
        LlmProperties properties = new LlmProperties();
        LlmProviderSettings settings = settings(properties, true);

        settings.save("siliconflow", "https://api.siliconflow.cn/v1", "Qwen/Qwen2.5-7B", "sk-x",
                null, null, null);

        LlmProviderConfig added = settings.snapshot().get("siliconflow");
        assertThat(added).isNotNull();
        assertThat(added.isComplete()).isTrue();
        assertThat(settings.localProviderIds()).containsExactly("siliconflow");
    }

    @Test
    void nullApiKeyMeansKeepExistingSoMaskedFormDoesNotWipeIt() {
        LlmProviderSettings settings = settings(new LlmProperties(), true);
        settings.save("glm", "https://a.example.com", "m1", "sk-first", null, null, null);

        // 界面上 Key 只显示掩码，用户只改模型名时传 null，不能把 Key 清掉
        settings.save("glm", "https://a.example.com", "m2", null, null, null, null);

        LlmProviderConfig current = settings.snapshot().get("glm");
        assertThat(current.getModel()).isEqualTo("m2");
        assertThat(current.getApiKey()).isEqualTo("sk-first");

        // 显式传空串才是清除
        settings.save("glm", "https://a.example.com", "m2", "", null, null, null);
        assertThat(settings.snapshot().get("glm").getApiKey()).isEmpty();
    }

    @Test
    void clearFallsBackToYml() {
        LlmProperties properties = new LlmProperties();
        LlmProviderConfig yml = new LlmProviderConfig();
        yml.setBaseUrl("https://yml.example.com");
        yml.setModel("yml-model");
        yml.setApiKey("yml-key");
        properties.getProviders().put("glm", yml);

        LlmProviderSettings settings = settings(properties, true);
        settings.save("glm", "https://local.example.com", "", "local-key", null, null, null);
        assertThat(settings.snapshot().get("glm").getBaseUrl()).isEqualTo("https://local.example.com");

        settings.clear("glm");
        assertThat(settings.snapshot().get("glm").getBaseUrl())
                .as("清除本地覆盖后应回到 yml 的值")
                .isEqualTo("https://yml.example.com");
        assertThat(settings.snapshot().get("glm").getApiKey()).isEqualTo("yml-key");
    }

    @Test
    void serverDeploymentCannotEditProviders() {
        LlmProviderSettings settings = settings(new LlmProperties(), false);

        assertThat(settings.isEditable()).isFalse();
        assertThatThrownBy(() -> settings.save("glm", "https://a", "m", "k", null, null, null))
                .isInstanceOf(com.timetable.exception.BusinessException.class)
                .hasMessageContaining("部署环境");
    }

    @Test
    void providerIdIsValidatedBecauseItBecomesAKeyAndPathSegment() {
        LlmProviderSettings settings = settings(new LlmProperties(), true);

        assertThatThrownBy(() -> settings.save("../../etc/passwd", "https://a", "m", "k", null, null, null))
                .isInstanceOf(com.timetable.exception.BusinessException.class);
        assertThatThrownBy(() -> settings.save("GLM Provider", "https://a", "m", "k", null, null, null))
                .isInstanceOf(com.timetable.exception.BusinessException.class);
    }

    @Test
    void versionChangesWhenConfigChangesAndStaysStableOtherwise() {
        LlmProviderSettings settings = settings(new LlmProperties(), true);
        String before = settings.version();

        assertThat(settings.version()).as("配置没动，版本必须稳定，否则每次都重建客户端").isEqualTo(before);

        settings.save("glm", "https://a.example.com", "m", "sk-1", null, null, null);
        String afterSave = settings.version();
        assertThat(afterSave).isNotEqualTo(before);

        // 换 Key 必须触发重建——否则用户改了 Key 还是用旧的
        settings.save("glm", "https://a.example.com", "m", "sk-2", null, null, null);
        assertThat(settings.version()).isNotEqualTo(afterSave);
    }

    @Test
    void registryPicksUpProviderSavedAtRuntimeWithoutRestart() {
        LlmProperties properties = new LlmProperties();
        LlmProviderSettings settings = settings(properties, true);

        // 一开始什么都没有：AI 不可用
        LlmClientRegistry registry = registry(settings, properties);
        assertThatThrownBy(registry::active)
                .isInstanceOf(com.timetable.exception.BusinessException.class);

        // 用户在设置页填了一个 provider
        settings.save("glm", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "sk-live",
                null, null, null);

        // 不重启就能用——这是「桌面版没有运维」的硬要求
        assertThat(registry.isActiveConfigured()).isTrue();
        assertThat(registry.registeredProviders()).contains("glm");
        assertThat(registry.forScene(com.timetable.entity.LlmUsage.SCENE_CHAT).providerId())
                .isEqualTo("glm");
    }

    @Test
    void maskNeverLeaksFullKey() {
        assertThat(LlmProviderSettings.mask("sk-1234567890abcdef")).isEqualTo("sk-1****cdef");
        assertThat(LlmProviderSettings.mask("short")).isEqualTo("****");
        assertThat(LlmProviderSettings.mask("")).isEmpty();
        assertThat(LlmProviderSettings.mask(null)).isEmpty();
    }

    // ==================== 辅助 ====================

    private LlmProviderSettings settings(LlmProperties properties, boolean editable) {
        LocalSettings local = new LocalSettings(dataDir.toString(), MASTER_KEY);
        return new LlmProviderSettings(properties, local, editable);
    }

    @SuppressWarnings("unchecked")
    private LlmClientRegistry registry(LlmProviderSettings settings, LlmProperties properties) {
        org.springframework.beans.factory.ObjectProvider<LlmProviderSettings> settingsProvider =
                mock(org.springframework.beans.factory.ObjectProvider.class);
        when(settingsProvider.getIfAvailable()).thenReturn(settings);
        org.springframework.beans.factory.ObjectProvider<ObjectMapper> mapperProvider =
                mock(org.springframework.beans.factory.ObjectProvider.class);
        when(mapperProvider.getIfAvailable()).thenReturn(new ObjectMapper());
        org.springframework.beans.factory.ObjectProvider<LlmUsageRecorder> recorderProvider =
                mock(org.springframework.beans.factory.ObjectProvider.class);
        when(recorderProvider.getIfAvailable()).thenReturn(mock(LlmUsageRecorder.class));

        // 没有内置 LlmClient：全部靠界面配置，这正是桌面版首次启动的样子
        return new LlmClientRegistry(List.of(), properties, mock(LlmBudgetService.class),
                settingsProvider, mapperProvider, recorderProvider);
    }
}
