package com.timetable.service.impl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Prompt 模板注册表（AI Campus Agent V1.0）。
 *
 * 模板放在 {@code resources/prompts/*.md}，可按版本管理：文件开头可用 front matter
 * 声明版本号，调用方拿到的 {@link PromptTemplate#version()} 可随提案一起记录，
 * 便于追溯「哪一版人格/指令产生了这条提案」。资源缺失时返回 null，由调用方降级
 * （人格缺失不阻断聊天，提炼模板缺失跳过提炼），不让坏包拖垮主流程。
 */
@Component
public class PromptTemplateRegistry {

    private static final Logger log = LoggerFactory.getLogger(PromptTemplateRegistry.class);

    private final Map<String, PromptTemplate> cache = new ConcurrentHashMap<>();

    /** 加载模板；不存在返回 null。 */
    public PromptTemplate get(String name) {
        return cache.computeIfAbsent(name, this::load);
    }

    private PromptTemplate load(String name) {
        ClassPathResource resource = new ClassPathResource("prompts/" + name + ".md");
        if (!resource.exists()) {
            log.warn("Prompt 模板缺失：prompts/{}.md，相关能力将降级", name);
            return null;
        }
        try (InputStream in = resource.getInputStream()) {
            String raw = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            return parse(name, raw);
        } catch (IOException e) {
            log.warn("Prompt 模板读取失败：prompts/{}.md（{}）", name, e.toString());
            return null;
        }
    }

    /**
     * 解析 front matter 版本声明：
     * <pre>
     * ---
     * version: 1
     * ---
     * 正文……
     * </pre>
     * 无声明时版本为 0、正文原样返回。front matter 必须是文件最开头的三行结构。
     */
    static PromptTemplate parse(String name, String raw) {
        String body = raw;
        int version = 0;
        String trimmed = raw.stripLeading();
        if (trimmed.startsWith("---\n") || trimmed.startsWith("---\r\n")) {
            int firstLineEnd = trimmed.indexOf('\n');
            int closingStart = trimmed.indexOf("\n---", firstLineEnd + 1);
            if (closingStart >= 0) {
                int closingLineEnd = trimmed.indexOf('\n', closingStart + 1);
                String closingLine = trimmed.substring(closingStart + 1,
                        closingLineEnd < 0 ? trimmed.length() : closingLineEnd).trim();
                if ("---".equals(closingLine)) {
                    String header = trimmed.substring(firstLineEnd + 1, closingStart).trim();
                    body = (closingLineEnd < 0 ? "" : trimmed.substring(closingLineEnd + 1)).stripLeading();
                    for (String line : header.split("\n")) {
                        String[] kv = line.split(":", 2);
                        if (kv.length == 2 && kv[0].trim().equals("version")) {
                            try {
                                version = Integer.parseInt(kv[1].trim());
                            } catch (NumberFormatException ignored) {
                                version = 0;
                            }
                        }
                    }
                }
            }
        }
        return new PromptTemplate(name, version, body);
    }

    /** 一个已加载的 Prompt 模板。 */
    public record PromptTemplate(String name, int version, String body) {
    }
}
