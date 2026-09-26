package com.timetable.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Properties;

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

    private final Path dataDir;
    private final Path file;
    private final Properties properties = new Properties();

    public LocalSettings(@Value("${app.data-dir:~/.tangent-timetable}") String dataDir) {
        this.dataDir = resolve(dataDir);
        this.file = this.dataDir.resolve(FILE_NAME);
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
        return properties.getProperty(key);
    }

    /** 写入设置项；值为 null 或空白时删除该项 */
    public synchronized void set(String key, String value) {
        if (value == null || value.isBlank()) {
            properties.remove(key);
        } else {
            properties.setProperty(key, value.trim());
        }
        store();
    }

    private void load() {
        if (!Files.isRegularFile(file)) {
            return;
        }
        try (InputStream in = Files.newInputStream(file)) {
            properties.load(in);
        } catch (IOException e) {
            // 读不出来不应阻止应用启动，按「无本地设置」处理
            log.warn("Failed to read {}: {}", file, e.getMessage());
        }
    }

    private void store() {
        try {
            Files.createDirectories(dataDir);
            try (OutputStream out = Files.newOutputStream(file)) {
                properties.store(out, "Tangent Timetable local settings");
            }
        } catch (IOException e) {
            throw new IllegalStateException("无法写入本地设置：" + file, e);
        }
    }
}
