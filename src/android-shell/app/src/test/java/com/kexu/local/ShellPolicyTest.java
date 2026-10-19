package com.kexu.local;

import static org.junit.Assert.*;
import org.junit.Test;

public class ShellPolicyTest {
    @Test public void localOriginIsExact() {
        assertTrue(ShellPolicy.isLocal("https://appassets.androidplatform.net/focus"));
        assertTrue(ShellPolicy.isLocal("https://appassets.androidplatform.net:443/focus"));
        for (String url : new String[] {"http://appassets.androidplatform.net/focus", "https://appassets.androidplatform.net.evil/focus", "https://evil@appassets.androidplatform.net/focus", "https://appassets.androidplatform.net:444/focus", "file:///android_asset/index.html", "content://data", "javascript:alert(1)"}) assertFalse(url, ShellPolicy.isLocal(url));
    }
    @Test public void onlyKnownRoutesNavigate() {
        assertTrue(ShellPolicy.navigationAllowed(ShellPolicy.ORIGIN + "/focus?date=2026-10-19#review"));
        assertFalse(ShellPolicy.navigationAllowed(ShellPolicy.ORIGIN + "/unknown"));
        assertFalse(ShellPolicy.navigationAllowed(ShellPolicy.ORIGIN + "/assets/app.js"));
    }
    @Test public void encodedTraversalAndSeparatorsRejected() {
        for (String path : new String[] {"/../x", "/a/./x", "/%2e%2e/x", "/assets%2Fx.js", "/assets%5cx.js", "/a//b", "/%00"}) assertFalse(path, ShellPolicy.safeEncodedPath(ShellPolicy.ORIGIN + path));
        assertTrue(ShellPolicy.safeEncodedPath(ShellPolicy.ORIGIN + "/assets/index-a123.js"));
    }
    @Test public void exportIsOnlyBoundedJsonBasename() {
        assertTrue(ShellPolicy.validExport("request-123", "Tangent-core-2026-10-19.json", "{\"ok\":true}"));
        for (String file : new String[] {"../backup.json", "/sdcard/a.json", "backup.exe", "a\\b.json", ".json", "a.json.html"}) assertFalse(file, ShellPolicy.validExport("id", file, "{}"));
        assertFalse(ShellPolicy.validExport("bad id", "data.json", "{}"));
        assertFalse(ShellPolicy.validExport("id", "data.json", "中".repeat(ShellPolicy.MAX_EXPORT_BYTES / 3 + 1)));
    }
    @Test public void externalLinksAreWebOnly() {
        assertTrue(ShellPolicy.externalHttps("https://example.org/help"));
        assertTrue(ShellPolicy.externalHttps("http://example.org/help"));
        assertFalse(ShellPolicy.externalHttps("intent://example"));
        assertFalse(ShellPolicy.externalHttps("https://name:password@example.org"));
        assertFalse(ShellPolicy.externalHttps(ShellPolicy.ORIGIN + "/focus"));
    }
}
