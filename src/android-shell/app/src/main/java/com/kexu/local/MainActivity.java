package com.kexu.local;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends ComponentActivity {
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private ExportRequest exportRequest;
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();
    private final Set<String> assetPaths = new HashSet<>();
    private ActivityResultLauncher<Intent> chooseFile;
    private ActivityResultLauncher<String> saveFile;

    private static final class ExportRequest {
        final String id;
        final byte[] bytes;
        final JavaScriptReplyProxy reply;
        ExportRequest(String id, String text, JavaScriptReplyProxy reply) {
            this.id = id;
            this.bytes = text.getBytes(StandardCharsets.UTF_8);
            this.reply = reply;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        chooseFile = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            if (callback == null) return;
            Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
            if (uris != null) for (Uri uri : uris) {
                if (!"content".equals(uri.getScheme())) { uris = null; break; }
            }
            callback.onReceiveValue(uris);
        });
        saveFile = registerForActivityResult(new ActivityResultContracts.CreateDocument("application/json"), uri -> {
            ExportRequest request = exportRequest;
            if (request == null) return;
            if (uri == null) {
                exportRequest = null;
                sendResult(request.reply, request.id, false, true, null);
                return;
            }
            fileWorker.execute(() -> {
                String error = null;
                try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                    if (stream == null) throw new java.io.IOException("文件暂时无法写入");
                    stream.write(request.bytes);
                    stream.flush();
                } catch (Exception ex) { error = "文件未保存，请重新选择保存位置"; }
                final String failure = error;
                runOnUiThread(() -> {
                    exportRequest = null;
                    sendResult(request.reply, request.id, failure == null, false, failure);
                });
            });
        });
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open("shell-assets.txt"), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) if (!line.trim().isEmpty()) assetPaths.add(line);
        } catch (Exception ex) {
            new AlertDialog.Builder(this).setTitle("安装包资源不完整").setMessage("请重新安装完整的Kexu安装包；本机数据不会在此处清除。")
                    .setPositiveButton("关闭", (dialog, which) -> finish()).setCancelable(false).show();
            return;
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(244, 248, 250));
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        ViewCompat.setOnApplyWindowInsetsListener(frame, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(frame);
        setupWebView();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else { setEnabled(false); getOnBackPressedDispatcher().onBackPressed(); }
            }
        });
        if (state == null || webView.restoreState(state) == null) webView.loadUrl(ShellPolicy.ORIGIN + "/focus");
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Only URIs explicitly returned by the system document picker are granted.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setBackgroundColor(Color.rgb(244, 248, 250));
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(ShellPolicy.HOST).setHttpAllowed(false)
                .addPathHandler("/", path -> loadAsset(path)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!request.isForMainFrame()) return true;
                if (ShellPolicy.navigationAllowed(url)) return false;
                if (request.hasGesture() && ShellPolicy.externalHttps(url)) openExternal(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ShellPolicy.isLocal(url)) {
                    if (!"GET".equals(request.getMethod()) || !ShellPolicy.safeEncodedPath(url)) return notFound();
                    WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                    return response == null ? notFound() : response;
                }
                String scheme = request.getUrl().getScheme();
                if (request.isForMainFrame() || !("https".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme))) return notFound();
                return null;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!ShellPolicy.navigationAllowed(view.getUrl())) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.setAction(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { chooseFile.launch(intent); }
                catch (ActivityNotFoundException ex) { fileCallback = null; callback.onReceiveValue(null); toast("未找到系统文件选择器"); }
                return true;
            }
        });
        webView.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (ShellPolicy.externalHttps(url)) openExternal(Uri.parse(url));
            else toast("请通过“导出核心数据文件”选择系统保存位置");
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "KexuNative", Collections.singleton(ShellPolicy.ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (!isMainFrame || !ShellPolicy.isLocal(sourceOrigin.toString()) || !ShellPolicy.navigationAllowed(view.getUrl())) return;
                        String id = "";
                        try {
                            String raw = message.getData();
                            if (raw == null || raw.length() > 2 * ShellPolicy.MAX_EXPORT_BYTES + 2048) throw new IllegalArgumentException();
                            JSONObject body = new JSONObject(raw);
                            id = body.optString("id");
                            String name = body.optString("filename");
                            String text = body.optString("text");
                            if (!"save-json".equals(body.optString("type")) || !ShellPolicy.validExport(id, name, text)) throw new IllegalArgumentException();
                            JSONTokener tokener = new JSONTokener(text);
                            Object value = tokener.nextValue();
                            if (!(value instanceof JSONObject || value instanceof JSONArray) || tokener.nextClean() != 0) throw new IllegalArgumentException();
                            if (exportRequest != null) { sendResult(reply, id, false, false, "请先完成当前文件保存"); return; }
                            exportRequest = new ExportRequest(id, text, reply);
                            saveFile.launch(name);
                        } catch (Exception ex) {
                            if (exportRequest != null && exportRequest.id.equals(id)) exportRequest = null;
                            if (id.matches("[A-Za-z0-9_-]{1,80}")) sendResult(reply, id, false, false, "导出内容无效、过大或系统保存器不可用");
                        }
                    });
        } else toast("请更新 Android System WebView，以启用安全文件导出");
    }

    private WebResourceResponse loadAsset(String path) {
        String relative = path;
        if (ShellPolicy.isRoute("/" + path)) relative = "index.html";
        if (!assetPaths.contains(relative)) return notFound();
        try {
            String mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(android.webkit.MimeTypeMap.getFileExtensionFromUrl(relative));
            if (relative.endsWith(".js") || relative.endsWith(".mjs")) mime = "text/javascript";
            if (mime == null) mime = "application/octet-stream";
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Referrer-Policy", "no-referrer");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("www/" + relative));
        } catch (Exception ex) { return notFound(); }
    }
    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }
    private void openExternal(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException ex) { toast("未找到可打开链接的浏览器"); }
    }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    private static void sendResult(JavaScriptReplyProxy reply, String id, boolean ok, boolean cancelled, String error) {
        try {
            JSONObject result = new JSONObject().put("type", "save-json-result").put("id", id).put("ok", ok);
            if (cancelled) result.put("cancelled", true);
            if (error != null) result.put("error", error);
            reply.postMessage(result.toString());
        } catch (Exception ignored) { /* The requesting document may have been closed. */ }
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (webView != null) webView.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (webView != null) { webView.stopLoading(); webView.destroy(); }
        fileWorker.shutdown();
        super.onDestroy();
    }
}
