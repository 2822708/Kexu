package com.timetable.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.StandardCopyOption;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Properties;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 桌面版本地设置：存放在数据目录下的 {@code settings.properties}。
 *
 * <p>桌面版没有运维去设环境变量，因此像 DeepSeek Key 这类「部署期配置」必须能在界面里填、
 * 落盘到本机。这里只负责最小的键值读写，不做任何业务判断。
 *
 * <p>{@code app.data-dir} 支持 {@code ~} 前缀（展开为 user.home），与 H2 的连接串保持一致。
 */
@Component
public class LocalSettings {

    private static final Logger log = LoggerFactory.getLogger(LocalSettings.class);
    private static final String FILE_NAME = "settings.properties";
    private static final String DEEPSEEK_KEY = "deepseek.api-key";
    private static final String ENCRYPTED_PREFIX = "ENCv1:";
    private static final int NONCE_LENGTH = 12;

    private final Path dataDir;
    private final Path file;
    private final String encryptionMasterKey;
    private final Properties properties = new Properties();

    public LocalSettings(@Value("${app.data-dir:~/.tangent-timetable}") String dataDir,
                         @Value("${TANGENT_SETTINGS_ENCRYPTION_KEY:}") String encryptionMasterKey) {
        this.dataDir = resolve(dataDir);
        this.file = this.dataDir.resolve(FILE_NAME);
        this.encryptionMasterKey = encryptionMasterKey == null || encryptionMasterKey.isBlank()
                ? null : encryptionMasterKey;
        load();
    }

    /** 把 {@code ~} 展开为 user.home，并创建数据目录 */
    public static Path resolve(String dir) {
        String value = dir == null || dir.isBlank() ? "~/.tangent-timetable" : dir.trim();
        if (value.startsWith("~")) {
            value = System.getProperty("user.home") + value.substring(1);
        }
        return Paths.get(value).toAbsolutePath().normalize();
    }

    public Path getDataDir() {
        return dataDir;
    }

    /** 读取一个设置项；不存在时返回 null */
    public synchronized String get(String key) {
        String value = properties.getProperty(key);
        if (DEEPSEEK_KEY.equals(key) && value != null && value.startsWith(ENCRYPTED_PREFIX)) {
            return decrypt(value.substring(ENCRYPTED_PREFIX.length()));
        }
        return value;
    }

    /** 写入设置项；值为 null 或空白时删除该项 */
    public synchronized void set(String key, String value) {
        if (value == null || value.isBlank()) {
            properties.remove(key);
        } else {
            properties.setProperty(key, DEEPSEEK_KEY.equals(key) ? encrypt(value.trim()) : value.trim());
        }
        store();
    }

    private void load() {
        if (!Files.isRegularFile(file)) {
            return;
        }
        try (InputStream in = Files.newInputStream(file)) {
            properties.load(in);
            String legacyKey = properties.getProperty(DEEPSEEK_KEY);
            if (legacyKey != null && !legacyKey.startsWith(ENCRYPTED_PREFIX)
                    && encryptionMasterKey != null) {
                properties.setProperty(DEEPSEEK_KEY, encrypt(legacyKey));
                store();
            }
        } catch (IOException e) {
            // 读不出来不应阻止应用启动，按「无本地设置」处理
            log.warn("Failed to read {}: {}", file, e.getMessage());
        }
    }

    private void store() {
        try {
            Files.createDirectories(dataDir);
            Path temporary = Files.createTempFile(dataDir, "settings-", ".tmp");
            try (OutputStream out = Files.newOutputStream(temporary)) {
                properties.store(out, "Tangent Timetable local settings");
            }
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException atomicMoveUnsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new IllegalStateException("无法写入本地设置：" + file, e);
        }
    }

    private String encrypt(String plainText) {
        if (encryptionMasterKey == null) {
            throw new IllegalStateException("本地密钥保护未配置，无法保存 AI 密钥");
        }
        try {
            byte[] nonce = new byte[NONCE_LENGTH];
            new SecureRandom().nextBytes(nonce);
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, nonce);
            cipher.updateAAD(DEEPSEEK_KEY.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            byte[] result = new byte[nonce.length + encrypted.length];
            System.arraycopy(nonce, 0, result, 0, nonce.length);
            System.arraycopy(encrypted, 0, result, nonce.length, encrypted.length);
            return ENCRYPTED_PREFIX + java.util.Base64.getEncoder().encodeToString(result);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("无法保护本地 AI 密钥", e);
        }
    }

    private String decrypt(String encoded) {
        if (encryptionMasterKey == null) {
            throw new IllegalStateException("本地 AI 密钥已加密；请使用原 Windows 用户启动桌面应用");
        }
        try {
            byte[] data = java.util.Base64.getDecoder().decode(encoded);
            if (data.length <= NONCE_LENGTH) {
                throw new GeneralSecurityException("Encrypted setting is truncated");
            }
            byte[] nonce = java.util.Arrays.copyOfRange(data, 0, NONCE_LENGTH);
            byte[] encrypted = java.util.Arrays.copyOfRange(data, NONCE_LENGTH, data.length);
            Cipher cipher = cipher(Cipher.DECRYPT_MODE, nonce);
            cipher.updateAAD(DEEPSEEK_KEY.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("无法解密本地 AI 密钥；请检查 Windows 用户凭据状态", e);
        }
    }

    private Cipher cipher(int mode, byte[] nonce) throws GeneralSecurityException {
        byte[] key = MessageDigest.getInstance("SHA-256")
                .digest(encryptionMasterKey.getBytes(StandardCharsets.UTF_8));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        return cipher;
    }
}
