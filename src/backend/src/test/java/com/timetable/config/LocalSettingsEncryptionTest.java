package com.timetable.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 本地设置的敏感项加密。
 *
 * <p>这组测试的存在理由很具体：早期实现只对字面量 {@code deepseek.api-key} 加密，
 * 其它键一律明文落盘。等我们要支持多 provider（{@code llm.provider.<id>.api-key}）时，
 * 它会静默把用户的 Key 明文写进磁盘，而界面还在承诺「加密保存」。
 * 所以这里钉住的是「<b>凡是 api-key 结尾的键都必须加密</b>」这条不变量，而不是某个具体键名。
 */
class LocalSettingsEncryptionTest {

    private static final String MASTER_KEY = "unit-test-master-key";

    @TempDir
    Path dataDir;

    @Test
    void secretKeysAreEncryptedOnDiskAndReadBackInPlainText() throws Exception {
        LocalSettings settings = new LocalSettings(dataDir.toString(), MASTER_KEY);

        settings.set("deepseek.api-key", "sk-deepseek-secret");
        settings.set("llm.provider.glm.api-key", "glm-secret-value");

        Properties raw = readRaw();
        assertThat(raw.getProperty("deepseek.api-key")).startsWith("ENCv1:");
        assertThat(raw.getProperty("llm.provider.glm.api-key"))
                .as("新增的 provider Key 必须同样加密——这正是当初漏掉的地方")
                .startsWith("ENCv1:");
        // 明文绝不能出现在文件里
        String fileText = Files.readString(dataDir.resolve("settings.properties"));
        assertThat(fileText).doesNotContain("sk-deepseek-secret").doesNotContain("glm-secret-value");

        // 读回来必须是明文
        assertThat(settings.get("deepseek.api-key")).isEqualTo("sk-deepseek-secret");
        assertThat(settings.get("llm.provider.glm.api-key")).isEqualTo("glm-secret-value");
    }

    @Test
    void nonSecretKeysStayReadableForSupport() throws Exception {
        LocalSettings settings = new LocalSettings(dataDir.toString(), MASTER_KEY);
        settings.set("llm.active-provider", "glm");

        // 非敏感项不加密：出问题时运维要能直接看懂配置文件
        assertThat(readRaw().getProperty("llm.active-provider")).isEqualTo("glm");
        assertThat(settings.get("llm.active-provider")).isEqualTo("glm");
    }

    @Test
    void ciphertextOfOneKeyCannotBeMovedToAnother() throws Exception {
        LocalSettings settings = new LocalSettings(dataDir.toString(), MASTER_KEY);
        settings.set("deepseek.api-key", "sk-one");

        // 把密文挪到另一个键名下：AAD 绑定键名，必须解不出来
        String cipherText = readRaw().getProperty("deepseek.api-key");
        Properties raw = readRaw();
        raw.setProperty("llm.provider.glm.api-key", cipherText);
        raw.store(Files.newOutputStream(dataDir.resolve("settings.properties")), "");

        LocalSettings reloaded = new LocalSettings(dataDir.toString(), MASTER_KEY);
        assertThatThrownBy(() -> reloaded.get("llm.provider.glm.api-key"))
                .as("AAD 绑定键名后，不同键的密文不能互换，否则换键就能读出别人的 Key")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void legacyPlaintextSecretIsEncryptedOnNextStartup() throws Exception {
        // 模拟旧版本留下的明文文件
        Properties raw = new Properties();
        raw.setProperty("llm.provider.glm.api-key", "legacy-plaintext-key");
        raw.store(Files.newOutputStream(dataDir.resolve("settings.properties")), "");

        LocalSettings settings = new LocalSettings(dataDir.toString(), MASTER_KEY);

        assertThat(settings.get("llm.provider.glm.api-key")).isEqualTo("legacy-plaintext-key");
        assertThat(readRaw().getProperty("llm.provider.glm.api-key"))
                .as("启动时应把历史明文敏感项补加密")
                .startsWith("ENCv1:");
    }

    @Test
    void legacyCiphertextWithFixedAadStillDecrypts() throws Exception {
        // 先写入，再用旧格式（AAD 固定为 deepseek.api-key）重新加密，模拟 V1 存量密文
        LocalSettings first = new LocalSettings(dataDir.toString(), MASTER_KEY);
        first.set("deepseek.api-key", "sk-v1-era");
        String legacy = legacyEncrypt("sk-v1-era");

        Properties raw = readRaw();
        raw.setProperty("deepseek.api-key", legacy);
        raw.store(Files.newOutputStream(dataDir.resolve("settings.properties")), "");

        LocalSettings reloaded = new LocalSettings(dataDir.toString(), MASTER_KEY);
        assertThat(reloaded.get("deepseek.api-key"))
                .as("升级不能把老用户已保存的 Key 变成不可读")
                .isEqualTo("sk-v1-era");
    }

    @Test
    void missingMasterKeyDoesNotBreakStartup() throws Exception {
        // 没配加密主密钥时，读到一个加密值应当报错而不是让整个应用起不来
        LocalSettings settings = new LocalSettings(dataDir.toString(), MASTER_KEY);
        settings.set("deepseek.api-key", "sk-needs-master-key");

        assertThatThrownBy(() -> new LocalSettings(dataDir.toString(), "").get("deepseek.api-key"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("加密");
    }

    // ==================== 辅助 ====================

    private Properties readRaw() throws Exception {
        Properties raw = new Properties();
        try (InputStream in = Files.newInputStream(dataDir.resolve("settings.properties"))) {
            raw.load(in);
        }
        return raw;
    }

    /** 复刻 V1 的加密格式：AAD 硬编码为 deepseek.api-key。 */
    private String legacyEncrypt(String plainText) throws Exception {
        byte[] nonce = new byte[12];
        new java.security.SecureRandom().nextBytes(nonce);
        byte[] key = java.security.MessageDigest.getInstance("SHA-256")
                .digest(MASTER_KEY.getBytes(StandardCharsets.UTF_8));
        javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,
                new javax.crypto.spec.SecretKeySpec(key, "AES"),
                new javax.crypto.spec.GCMParameterSpec(128, nonce));
        cipher.updateAAD("deepseek.api-key".getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
        byte[] result = new byte[nonce.length + encrypted.length];
        System.arraycopy(nonce, 0, result, 0, nonce.length);
        System.arraycopy(encrypted, 0, result, nonce.length, encrypted.length);
        return "ENCv1:" + java.util.Base64.getEncoder().encodeToString(result);
    }
}
