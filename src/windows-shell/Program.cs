// Local-data PWA host. C# 5 / .NET Framework 4.8; no Java or Node process.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Kexu.Windows
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            string application = AppDomain.CurrentDomain.BaseDirectory;
            string data = null;
            bool smoke = false;
            foreach (string arg in args) {
                if (arg.StartsWith("--data-dir=", StringComparison.Ordinal)) data = Path.GetFullPath(arg.Substring(11));
                else if (arg == "--smoke-test") smoke = true;
                else { MessageBox.Show("无法识别启动参数。", "Kexu"); return; }
            }
            if (smoke && data == null) throw new ArgumentException("Smoke tests require an isolated --data-dir.");
            if (data == null && File.Exists(Path.Combine(application, "kexu-data-dir.txt"))) {
                string configured = File.ReadAllText(Path.Combine(application, "kexu-data-dir.txt")).Trim();
                if (configured.Length == 0 || configured.IndexOfAny(new char[] {'\r', '\n', '\0'}) >= 0) throw new InvalidDataException("Invalid data directory configuration.");
                data = Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(application, configured));
            }
            data = data ?? Path.Combine(application, "Data");
            string mutexKey;
            using (SHA256 hash = SHA256.Create()) mutexKey = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(data.TrimEnd('\\').ToUpperInvariant()))).Replace("-", "");
            bool first;
            using (Mutex mutex = new Mutex(true, "Local\\Kexu.LocalPwa." + mutexKey, out first)) {
                if (!first) { if (!smoke) MessageBox.Show("这份Kexu数据已在另一个窗口打开。", "Kexu"); Environment.ExitCode = 2; return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new ShellForm(application, data, smoke));
                GC.KeepAlive(mutex);
            }
        }
    }

    internal sealed class ShellForm : Form
    {
        private readonly WebView2 view = new WebView2();
        private readonly string application, data;
        private readonly bool smoke;
        private bool handlingSave, smokeRunning;
        private string runtimeVersion;
        private string smokeStage = "initializing";
        private CoreWebView2 browser;
        private int completedNavigations;

        internal ShellForm(string application, string data, bool smoke)
        {
            this.application = application; this.data = data; this.smoke = smoke;
            Text = "Kexu"; StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi; ClientSize = new Size(1200, 820); MinimumSize = new Size(390, 600);
            Icon = Icon.ExtractAssociatedIcon(Path.Combine(application, "Kexu.exe"));
            view.Dock = DockStyle.Fill; Controls.Add(view);
            view.HandleDestroyed += delegate { Trace("WebView HWND destroyed"); };
            view.Disposed += delegate { Trace("WebView disposed"); };
            FormClosing += delegate { Trace("Form closing"); };
            if (smoke) { ShowInTaskbar = false; Opacity = 0; }
            // Initialize after the first show/DPI layout so WinForms does not recreate
            // the WebView HWND between EnsureCoreWebView2Async and navigation.
            Shown += delegate { Initialize(); };
            FormClosed += delegate { view.Dispose(); };
        }

        private async void Initialize()
        {
            try {
                string www = Path.Combine(application, "app");
                if (!File.Exists(Path.Combine(www, "index.html"))) throw new FileNotFoundException("缺少 app/index.html，请解压完整便携包。");
                Directory.CreateDirectory(data);
                string probe = Path.Combine(data, ".write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(probe, "ok"); File.Delete(probe);
                string fixedRuntime = Path.Combine(application, "webview2-runtime");
                if (!File.Exists(Path.Combine(fixedRuntime, "msedgewebview2.exe"))) fixedRuntime = null;
                var environment = await CoreWebView2Environment.CreateAsync(fixedRuntime, Path.Combine(data, "WebView2"));
                await view.EnsureCoreWebView2Async(environment);
                var core = view.CoreWebView2;
                browser = core;
                Trace("Core initialized");
                core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) { Trace("Browser process failure: " + e.ProcessFailedKind); };
                runtimeVersion = core.Environment.BrowserVersionString;
                core.SetVirtualHostNameToFolderMapping(ShellPolicy.Host, www, CoreWebView2HostResourceAccessKind.DenyCors);
                core.Settings.AreDevToolsEnabled = smoke;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = true;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsWebMessageEnabled = true;
                core.NavigationStarting += OnNavigation;
                core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
                    e.Handled = true;
                    if (e.IsUserInitiated && ShellPolicy.IsExternalHttp(e.Uri)) OpenExternal(e.Uri);
                };
                core.FrameNavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = true; };
                core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) {
                    e.State = CoreWebView2PermissionState.Deny; e.SavesInProfile = false;
                    if (!smoke && ShellPolicy.IsAppDocument(e.Uri) && e.IsUserInitiated && e.PermissionKind == CoreWebView2PermissionKind.Microphone
                        && MessageBox.Show(this, "是否允许本次使用麦克风输入？语音服务可能需要联网。", "Kexu", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                        e.State = CoreWebView2PermissionState.Allow;
                };
                core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) { e.Cancel = true; e.Handled = true; };
                core.WebMessageReceived += OnMessage;
                core.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                    Trace("Navigation complete " + e.IsSuccess + " " + e.WebErrorStatus);
                    if (e.IsSuccess) completedNavigations++;
                    if (smoke && !smokeRunning) { smokeRunning = true; RunSmoke(); }
                };
                // Virtual-host mapping resolves physical files without an SPA fallback.
                // Always load the physical index, then restore only an allowed logical
                // route before React starts. The same bridge handles F5/deep links.
                await core.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin==='" + ShellPolicy.Origin + "'&&location.pathname==='/index.html'){var t=new URLSearchParams(location.search).get('__kexu_route')||'/focus';var u=new URL(t,location.origin);if(u.origin===location.origin&&['/','/focus','/timetable','/todos','/ai','/settings','/manual','/import'].indexOf(u.pathname)>=0)history.replaceState(null,'',u.pathname+u.search+u.hash);else history.replaceState(null,'','/focus');}");
                NavigateDocument("/focus");
            } catch (Exception error) { Fail(error); }
        }

        private void OnNavigation(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (ShellPolicy.IsAppDocument(e.Uri)) {
                Uri uri = new Uri(e.Uri);
                if (uri.AbsolutePath == "/index.html") return;
                e.Cancel = true;
                string routePath = uri.AbsolutePath.TrimEnd('/');
                string route = (routePath.Length == 0 ? "/" : routePath) + uri.Query + uri.Fragment;
                BeginInvoke(new Action(delegate { if (!IsDisposed) NavigateDocument(route); }));
                return;
            }
            e.Cancel = true;
            if (e.IsUserInitiated && ShellPolicy.IsExternalHttp(e.Uri)) OpenExternal(e.Uri);
        }

        private void NavigateDocument(string route)
        {
            browser.Navigate(ShellPolicy.Origin + "/index.html?__kexu_route=" + Uri.EscapeDataString(route));
        }

        private void OpenExternal(string uri)
        {
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
            catch { MessageBox.Show(this, "无法打开系统浏览器，请检查默认浏览器设置。", "Kexu"); }
        }

        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            SaveRequest request;
            try { request = ShellPolicy.ParseSaveRequest(e.Source, view.CoreWebView2.Source, e.WebMessageAsJson); }
            catch { return; }
            if (handlingSave) { Reply(request.Id, false, false, "另一个保存窗口尚未关闭。"); return; }
            handlingSave = true;
            try {
                using (var dialog = new SaveFileDialog { FileName = request.Filename, InitialDirectory = data, Filter = "JSON备份 (*.json)|*.json", DefaultExt = "json", AddExtension = true, OverwritePrompt = true, RestoreDirectory = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) { Reply(request.Id, false, true, null); return; }
                    // User chooses a path using the native dialog; no path is accepted from web content.
                    if (!string.Equals(Path.GetExtension(dialog.FileName), ".json", StringComparison.OrdinalIgnoreCase)) {
                        Reply(request.Id, false, false, "请选择.json文件名。"); return;
                    }
                    string temporary = dialog.FileName + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try {
                        File.WriteAllText(temporary, request.Text, new UTF8Encoding(false));
                        if (File.Exists(dialog.FileName)) File.Replace(temporary, dialog.FileName, null);
                        else File.Move(temporary, dialog.FileName);
                    } finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    Reply(request.Id, true, false, null);
                }
            } catch { Reply(request.Id, false, false, "文件保存失败，请检查目标目录与磁盘空间。"); }
            finally { handlingSave = false; }
        }

        private void Reply(string id, bool ok, bool cancelled, string error)
        {
            if (!ShellPolicy.IsAppDocument(view.CoreWebView2.Source)) return;
            var result = new Dictionary<string, object> { { "type", "save-json-result" }, { "id", id }, { "ok", ok } };
            if (cancelled) result.Add("cancelled", true);
            if (error != null) result.Add("error", error);
            view.CoreWebView2.PostWebMessageAsJson(ShellPolicy.Json().Serialize(result));
        }

        private async void RunSmoke()
        {
            try {
                smokeStage = "waiting-for-react";
                await Task.Delay(200);
                bool ready = false;
                for (int i = 0; i < 80; i++) {
                    var smokeCore = browser;
                    if (smokeCore == null) throw new InvalidOperationException("WebView2 control lost its CoreWebView2 after navigation.");
                    var readiness = smokeCore.ExecuteScriptAsync("Boolean(document.querySelector('.daily-workspace') && document.querySelector('input[aria-label=\"快速记录任务\"]:not(:disabled)') && document.querySelector('button[aria-label=\"保存日任务\"]') && location.pathname === '/focus' && isSecureContext && typeof indexedDB === 'object')");
                    if (readiness == null) throw new InvalidOperationException("ExecuteScriptAsync returned no readiness task.");
                    if (await readiness == "true") { ready = true; break; }
                    await Task.Delay(250);
                }
                if (!ready) throw new InvalidOperationException("Rendered focus page / secure origin / IndexedDB did not become ready.");
                smokeStage = "creating-real-daily-task";
                const string taskTitle = "Windows封装隔离验证任务";
                bool taskPersisted = await browser.ExecuteScriptAsync("document.body.innerText.indexOf('" + taskTitle + "')>=0") == "true";
                if (!taskPersisted) {
                    if (await browser.ExecuteScriptAsync("(function(){var i=document.querySelector('input[aria-label=\"快速记录任务\"]');if(!i||i.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'" + taskTitle + "');i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()") != "true") throw new InvalidOperationException("Rendered daily input was unavailable.");
                    bool saveReady = false;
                    for (int i = 0; i < 60; i++) {
                        if (await browser.ExecuteScriptAsync("Boolean(document.querySelector('button[aria-label=\"保存日任务\"]:not(:disabled)'))") == "true") { saveReady = true; break; }
                        await Task.Delay(100);
                    }
                    if (!saveReady) throw new InvalidOperationException("Daily form did not enable its save button after input.");
                    await browser.ExecuteScriptAsync("document.querySelector('button[aria-label=\"保存日任务\"]:not(:disabled)').click()");
                    bool added = false;
                    for (int i = 0; i < 60; i++) {
                        if (await browser.ExecuteScriptAsync("document.body.innerText.indexOf('" + taskTitle + "')>=0") == "true") { added = true; break; }
                        await Task.Delay(100);
                    }
                    if (!added) throw new InvalidOperationException("Real daily task could not be saved through the rendered form.");
                }
                smokeStage = "opening-isolated-indexeddb";
                // This dedicated database exists only in the explicitly isolated smoke profile.
                string script = "window.__kexuSmoke='pending';(function(){var r=indexedDB.open('kexu-shell-isolated-smoke',1);r.onupgradeneeded=function(){r.result.createObjectStore('probe')};r.onsuccess=function(){var db=r.result;var t=db.transaction('probe','readwrite');var s=t.objectStore('probe');var q=s.get('sentinel');q.onsuccess=function(){window.__kexuSmokeWasPersisted=q.result==='retained';s.put('retained','sentinel')};t.oncomplete=function(){db.close();window.__kexuSmoke='passed'};t.onerror=function(){window.__kexuSmoke='failed'}};r.onerror=function(){window.__kexuSmoke='failed'}})();";
                await browser.ExecuteScriptAsync(script);
                smokeStage = "waiting-for-indexeddb";
                bool stored = false;
                for (int i = 0; i < 40; i++) {
                    if (await browser.ExecuteScriptAsync("window.__kexuSmoke === 'passed'") == "true") { stored = true; break; }
                    await Task.Delay(100);
                }
                if (!stored) throw new InvalidOperationException("Isolated IndexedDB write failed.");
                smokeStage = "reading-persistence-result";
                bool persisted = await browser.ExecuteScriptAsync("window.__kexuSmokeWasPersisted === true") == "true";
                smokeStage = "reloading-logical-route";
                int previousNavigations = completedNavigations;
                browser.Reload();
                bool reloaded = false;
                for (int i = 0; i < 100; i++) {
                    await Task.Delay(100);
                    if (completedNavigations > previousNavigations && await browser.ExecuteScriptAsync("location.pathname==='/focus'&&document.body.innerText.indexOf('" + taskTitle + "')>=0") == "true") { reloaded = true; break; }
                }
                if (!reloaded) throw new InvalidOperationException("Logical /focus reload or real daily task persistence failed.");
                smokeStage = "writing-smoke-result";
                File.WriteAllText(Path.Combine(data, "shell-smoke-result.json"), ShellPolicy.Json().Serialize(new {
                    ok = true, origin = ShellPolicy.Origin, route = "/focus", runtime = runtimeVersion,
                    rendered = true, secureContext = true, indexedDb = true, persistedAcrossLaunch = persisted,
                    realDailyTaskSaved = true, realDailyTaskPersistedAcrossLaunch = taskPersisted, logicalRouteReload = reloaded,
                    dataDirectory = data, requiresBackend = false, requiresNode = false
                }), new UTF8Encoding(false));
                Close();
            } catch (Exception error) { Fail(error); }
        }

        private void Fail(Exception error)
        {
            Environment.ExitCode = 1;
            if (smoke) {
                Directory.CreateDirectory(data);
                File.WriteAllText(Path.Combine(data, "shell-smoke-result.json"), ShellPolicy.Json().Serialize(new { ok = false, stage = smokeStage, error = error.ToString() }), new UTF8Encoding(false));
            } else MessageBox.Show(this, "Kexu无法启动。请保留Data目录，确认已完整解压且安装了Microsoft Edge WebView2 Runtime。\n\n" + error.Message, "Kexu", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        private void Trace(string text)
        {
            if (!smoke) return;
            Directory.CreateDirectory(data);
            File.AppendAllText(Path.Combine(data, "shell-smoke-trace.txt"), DateTime.UtcNow.ToString("o") + " " + text + "\r\n", new UTF8Encoding(false));
        }
    }
}
