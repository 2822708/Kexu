package com.kexu.local;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;

/** Pure policy shared by request interception, navigation and unit tests. */
public final class ShellPolicy {
    public static final String HOST = "appassets.androidplatform.net";
    public static final String ORIGIN = "https://" + HOST;
    public static final int MAX_EXPORT_BYTES = 11 * 1024 * 1024;
    private static final Set<String> ROUTES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList("/", "/index.html", "/focus", "/timetable", "/todos", "/ai", "/settings", "/manual", "/widget")));
    private ShellPolicy() { }

    public static boolean isLocal(String value) {
        if (value == null) return false;
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost())
                    && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
        } catch (IllegalArgumentException ex) { return false; }
    }

    public static boolean safeEncodedPath(String value) {
        if (value == null) return false;
        try {
            String path = URI.create(value).getRawPath();
            if (path == null || !path.startsWith("/")) return false;
            String lower = path.toLowerCase(java.util.Locale.ROOT);
            if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")
                    || lower.contains("%00") || path.contains("\\") || path.contains("//")) return false;
            for (String part : path.split("/")) if (part.equals("..") || part.equals(".")) return false;
            return true;
        } catch (IllegalArgumentException ex) { return false; }
    }

    public static boolean isRoute(String path) { return ROUTES.contains(path); }
    public static boolean navigationAllowed(String value) {
        if (!isLocal(value) || !safeEncodedPath(value)) return false;
        return isRoute(URI.create(value).getPath());
    }
    public static boolean externalHttps(String value) {
        if (value == null) return false;
        try {
            URI uri = URI.create(value);
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && uri.getUserInfo() == null && !isLocal(value);
        } catch (IllegalArgumentException ex) { return false; }
    }
    public static boolean validExport(String id, String filename, String text) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,80}")
                && filename != null && filename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,114}\\.json")
                && text != null && text.length() <= MAX_EXPORT_BYTES
                && text.getBytes(StandardCharsets.UTF_8).length <= MAX_EXPORT_BYTES;
    }
}
