// 大切课程表 —— Windows 桌面外壳（.NET Framework 4.8 + WebView2）
//
// 职责：
//   1. 单实例：已有实例在跑就直接提示退出
//   2. 本机账号：首次运行生成一个随机 API Key 存在数据目录，之后自动登录，用户无需手输
//   3. 启动内置后端（jlink 裁剪运行时 + Spring Boot fat jar），数据落在 %LOCALAPPDATA%
//   4. 用 WebView2 打开界面（无地址栏，就是桌面应用的样子）
//   5. 关窗时结束后端进程；并用 Job Object 保证外壳异常退出时子进程也被系统回收
//
// 外壳生成并用当前 Windows 用户的 DPAPI 保护本机凭据，通过子进程环境交给后端。
// 自动登录仅在已确认归属于该后端的精确 loopback origin 顶层文档中执行。
//
// 编译：csc /target:winexe /platform:x64（见 build-desktop.ps1）
// 注意：本文件必须保持 C# 5 语法 —— 只能用 .NET Framework 自带的 csc（它不认 C# 6+）。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Net.Sockets;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TangentTimetable
{
    internal static class Program
    {
        internal const int Port = 17817;
        private const string MutexName = "TangentTimetable.SingleInstance.v1";

        private static readonly IntPtr DpiAwarenessPerMonitorV2 = new IntPtr(-4);
        private static readonly IntPtr DpiAwarenessPerMonitor = new IntPtr(-3);
        private static readonly IntPtr DpiAwarenessSystem = new IntPtr(-2);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        /// <summary>窗口所在显示器的 DPI（Win10 1607+）</summary>
        [DllImport("user32.dll")]
        internal static extern uint GetDpiForWindow(IntPtr hwnd);

        /// <summary>直接设置窗口的物理像素位置与尺寸</summary>
        [DllImport("user32.dll")]
        internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter,
            int x, int y, int width, int height, uint flags);

        /// <summary>
        /// 声明 DPI 感知。app.manifest 已经声明过一次，这里再调用一次是为了在清单被忽略或
        /// 被环境覆盖时仍然生效（若已声明，该调用会失败并返回 false，属正常情况）。
        ///
        /// 不声明时进程是 DPI-UNAWARE：在 200% 缩放的屏幕上 Windows 会把整个窗口位图放大，
        /// 界面与 WebView 内容都会发虚。
        /// </summary>
        private static void EnableDpiAwareness()
        {
            try
            {
                if (SetProcessDpiAwarenessContext(DpiAwarenessPerMonitorV2)) return;
                if (SetProcessDpiAwarenessContext(DpiAwarenessPerMonitor)) return;
                SetProcessDpiAwarenessContext(DpiAwarenessSystem);
            }
            catch (Exception)
            {
                // 旧版 Windows 没有该 API：由清单里的 true/pm 兜底
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            string isolatedDataDir = null;
            bool smokeTest = false;
            foreach (string arg in args)
            {
                if (arg.StartsWith("--data-dir=", StringComparison.Ordinal)) isolatedDataDir = Path.GetFullPath(arg.Substring(11));
                else if (arg == "--smoke-test") smokeTest = true;
                else throw new ArgumentException("Unknown desktop argument");
            }
            if (smokeTest && isolatedDataDir == null) throw new ArgumentException("Smoke tests require --data-dir");
            EnableDpiAwareness();
            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("大切课程表已经在运行了。", "大切课程表",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(isolatedDataDir, smokeTest));
                GC.KeepAlive(mutex);
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 webView = new WebView2();
        private readonly string dataDir;
        private readonly bool smokeTest;
        private readonly System.Windows.Forms.Timer trustMonitor = new System.Windows.Forms.Timer();
        private bool closing;
        private string accountKey;
        private bool freshAccount;
        private Process backend;
        private bool ownsBackend;
        private JobObject job;

        internal MainForm(string isolatedDataDir, bool smokeTest)
        {
            this.smokeTest = smokeTest;
            this.Text = "大切课程表";
            if (smokeTest) { this.ShowInTaskbar = false; this.Opacity = 0; }

            // 窗口内容只有一个 Dock 填充的 WebView2，不需要 WinForms 自动缩放布局；
            // 尺寸在 OnLoad 里按窗口实际 DPI 换算，避免与 AutoScaleMode 重复缩放。
            this.AutoScaleMode = AutoScaleMode.None;
            this.StartPosition = FormStartPosition.CenterScreen;

            this.webView.Dock = DockStyle.Fill;
            this.Controls.Add(this.webView);

            this.dataDir = isolatedDataDir ?? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TangentTimetable");
        }

        /// <summary>
        /// 按窗口所在显示器的 DPI 设置窗口的物理尺寸，并在工作区内居中。
        ///
        /// 为什么用 Win32 而不是 Form.Width/Height：WinForms 在首次显示时会再按 DPI 缩放一次
        /// 窗口尺寸（实测把 2360x1640 缩成 1180x820，正好 0.5 倍），所以在 OnShown 里直接落
        /// 最终物理尺寸最可靠。DPI 用 GetDpiForWindow 取，它报告的是窗口所在显示器。
        /// </summary>
        private void ApplyPhysicalWindowSize()
        {
            int dpi = 96;
            try
            {
                int measured = (int)Program.GetDpiForWindow(this.Handle);
                if (measured > 0)
                {
                    dpi = measured;
                }
            }
            catch (Exception)
            {
                // 取不到就按 100% 处理
            }

            float scale = dpi / 96f;
            Rectangle work = Screen.FromControl(this).WorkingArea;   // DPI 感知进程下即为物理像素
            int width = Math.Min((int)(1180 * scale), work.Width - 40);
            int height = Math.Min((int)(820 * scale), work.Height - 40);
            int x = work.Left + (work.Width - width) / 2;
            int y = work.Top + (work.Height - height) / 2;

            const uint swpNoZOrder = 0x0004;
            const uint swpNoActivate = 0x0010;
            Program.SetWindowPos(this.Handle, IntPtr.Zero, x, y, width, height, swpNoZOrder | swpNoActivate);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try
            {
                Directory.CreateDirectory(dataDir);
                if (File.Exists(Path.Combine(dataDir, ".restore-in-progress")))
                    throw new InvalidOperationException("本机数据正在恢复或上次恢复尚未完成。请完成恢复工具的操作后再启动课程表；不要直接删除恢复标记。");
                EnsureAccountKey();
                StartBackendIfNeeded();
            }
            catch (Exception ex)
            {
                ReportFailure(ex);
                return;
            }
            InitWebView();
        }

        /// <summary>
        /// 读取（或首次生成）本机账号 Key。生成后立即落盘，避免中途崩溃导致账号丢失。
        /// 始终把该 Key 作为 bootstrap-key 传给后端：即使数据库被清空，
        /// 也会用同一个 Key 重建账号，用户不会突然被锁在外面。
        /// </summary>
        private void EnsureAccountKey()
        {
            accountKey = AccountKeyStore.LoadOrCreate(dataDir, out freshAccount);
        }

        /// <summary>拒绝复用未知本机服务；桌面外壳只连接自己启动的后端。</summary>
        private void StartBackendIfNeeded()
        {
            DesktopSecurity.EnsurePortAvailable(Program.Port);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string java = Path.Combine(baseDir, Path.Combine("runtime", Path.Combine("bin", "javaw.exe")));
            string jar = Path.Combine(baseDir, Path.Combine("app", "timetable-backend.jar"));
            if (!File.Exists(java) || !File.Exists(jar))
            {
                throw new FileNotFoundException(
                    "安装不完整：缺少 runtime\\bin\\javaw.exe 或 app\\timetable-backend.jar。\r\n"
                    + "请重新解压完整的安装目录后运行。");
            }

            string args = "-jar \"" + jar + "\""
                + " --spring.profiles.active=standalone"
                + " --app.data-dir=\"" + dataDir.Replace('\\', '/') + "\""
                + " --server.address=127.0.0.1"
                + " --server.port=" + Program.Port;

            ProcessStartInfo psi = new ProcessStartInfo(java, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = baseDir;
            // 环境变量避免把 API Key 暴露在 Java 进程命令行和进程列表中。
            psi.EnvironmentVariables["TANGENT_BOOTSTRAP_KEY"] = accountKey;
            psi.EnvironmentVariables["TANGENT_SETTINGS_ENCRYPTION_KEY"] = accountKey;

            backend = Process.Start(psi);
            ownsBackend = true;
            // 外壳被强杀时，靠 Job Object 让系统一并回收后端进程
            job = new JobObject();
            job.AddProcess(backend.Handle);

            WaitForServer();
            trustMonitor.Interval = 500;
            trustMonitor.Tick += delegate
            {
                if (!closing && !HasOwnedBackend())
                {
                    if (webView.CoreWebView2 != null) webView.CoreWebView2.Stop();
                    webView.Dispose();
                    ReportFailure(new InvalidOperationException("本机后端连接已中断，请重新启动课程表。"));
                }
            };
            trustMonitor.Start();
        }

        private bool HasOwnedBackend()
        {
            return backend != null && !backend.HasExited
                && DesktopSecurity.IsOwnedLoopbackListener(Program.Port, backend.Id);
        }

        private void WaitForServer()
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(90);
            while (DateTime.UtcNow < deadline)
            {
                if (backend != null && backend.HasExited)
                {
                    throw new InvalidOperationException(
                        "后端进程意外退出（退出码 " + backend.ExitCode + "）。\r\n日志："
                        + Path.Combine(dataDir, Path.Combine("logs", "timetable.log")));
                }
                if (HasOwnedBackend() && IsServerUp())
                {
                    return;
                }
                Thread.Sleep(300);
            }
            throw new TimeoutException(
                "后端启动超时。\r\n日志：" + Path.Combine(dataDir, Path.Combine("logs", "timetable.log")));
        }

        /// <summary>进程所有权已验证后，确认本机账号可用，避免把未完成 bootstrap 的服务当作就绪。</summary>
        private bool IsServerUp()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Program.Port + "/api/auth/verify");
                req.Method = "GET";
                req.AllowAutoRedirect = false;
                req.Proxy = null;
                req.Timeout = 2000;
                req.ReadWriteTimeout = 2000;
                req.Headers["X-API-Key"] = accountKey;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                    {
                        char[] buffer = new char[4096];
                        int count = reader.Read(buffer, 0, buffer.Length);
                        return resp.StatusCode == HttpStatusCode.OK
                            && System.Text.RegularExpressions.Regex.IsMatch(new string(buffer, 0, count), "\"valid\"\\s*:\\s*true");
                    }
                }
            }
            catch (WebException ex)
            {
                if (ex.Response != null) ex.Response.Close();
                return false;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private async void InitWebView()
        {
            try
            {
                string userDataFolder = Path.Combine(dataDir, "webview2");
                Directory.CreateDirectory(userDataFolder);
                CoreWebView2Environment env =
                    await CoreWebView2Environment.CreateAsync(
                        Directory.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "webview2-runtime"))
                            ? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "webview2-runtime") : null,
                        userDataFolder, null);
                await this.webView.EnsureCoreWebView2Async(env);

                CoreWebView2Settings settings = this.webView.CoreWebView2.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.IsZoomControlEnabled = true;
                settings.AreDevToolsEnabled = false;
                settings.AreHostObjectsAllowed = false;
                this.webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
                this.webView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
                this.webView.CoreWebView2.FrameNavigationStarting += OnFrameNavigationStarting;
                this.webView.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e)
                {
                    bool allowMicrophone = e.PermissionKind == CoreWebView2PermissionKind.Microphone
                        && e.IsUserInitiated
                        && DesktopSecurity.IsTrustedOrigin(e.Uri, Program.Port)
                        && HasOwnedBackend();
                    e.State = allowMicrophone
                        ? CoreWebView2PermissionState.Allow
                        : CoreWebView2PermissionState.Deny;
                };
                this.webView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                this.webView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                this.webView.CoreWebView2.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs request)
                {
                    if (!DesktopSecurity.IsTrustedOrigin(request.Request.Uri, Program.Port) || !HasOwnedBackend())
                        request.Response = env.CreateWebResourceResponse(null, 403, "Untrusted origin or backend", "");
                };

                // Keep the key out of subframes and escape legacy keys as JavaScript data.
                await this.webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    DesktopSecurity.LoginScript(accountKey, Program.Port));
                if (!HasOwnedBackend()) throw new InvalidOperationException("后端进程所有权校验失败。");

                this.webView.Source = new Uri("http://127.0.0.1:" + Program.Port + "/");
            }
            catch (Exception ex)
            {
                ReportFailure(new InvalidOperationException("无法初始化 WebView2 组件，请确认 WebView2 Runtime 可用。\r\n" + ex.Message, ex));
            }
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (DesktopSecurity.IsTrustedOrigin(e.Uri, Program.Port) && HasOwnedBackend()) return;
            e.Cancel = true;
            if (e.IsUserInitiated)
            {
                OpenExternalUrl(e.Uri);
            }
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (e.IsUserInitiated) OpenExternalUrl(e.Uri);
        }

        private void OnFrameNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            // The product has no embedded remote documents. Block all frame navigations.
            e.Cancel = true;
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!smokeTest || closing) return;
            try
            {
                if (!e.IsSuccess || !HasOwnedBackend()) throw new InvalidOperationException("Desktop navigation failed");
                string ok = await webView.CoreWebView2.ExecuteScriptAsync("Boolean(document.getElementById('root') && localStorage.getItem('timetable.apiKey'))");
                if (ok != "true") throw new InvalidOperationException("Desktop document or auto-login missing");
                File.WriteAllText(Path.Combine(dataDir, "desktop-smoke-result.txt"),
                    "PASS: owned loopback backend, WebView document and auto-login\r\nWebView2 Runtime: "
                    + webView.CoreWebView2.Environment.BrowserVersionString + "\r\nBackend PID: " + backend.Id);
                Close();
            }
            catch (Exception ex) { ReportFailure(ex); }
        }

        private void ReportFailure(Exception ex)
        {
            if (closing) return;
            if (smokeTest)
            {
                File.WriteAllText(Path.Combine(dataDir, "desktop-smoke-result.txt"), "FAIL: " + ex.Message);
                Environment.ExitCode = 1;
            }
            else MessageBox.Show(ex.Message, "大切课程表 - 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        private static void OpenExternalUrl(string value)
        {
            if (!DesktopSecurity.IsExternalWebUrl(value)) return;
            Uri target = new Uri(value);
            try
            {
                ProcessStartInfo start = new ProcessStartInfo(target.AbsoluteUri);
                start.UseShellExecute = true;
                Process.Start(start);
            }
            catch (Exception)
            {
                // 外部浏览器不可用时保持桌面应用在可信本机页面。
            }
        }

        /// <summary>首次运行时把本机账号 Key 显示一次，便于在其它设备（小组件/手机）使用。</summary>
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            // 放在 OnShown 而不是 OnLoad：WinForms 首次显示时会再缩放一次窗口尺寸
            ApplyPhysicalWindowSize();
            if (smokeTest || !freshAccount)
            {
                return;
            }
            MessageBox.Show(
                "已为你创建本机账号，并已自动登录，无需手动输入。\r\n\r\n"
                + "账号恢复凭据如下，请保存在你的密码管理器中。本机服务只供当前电脑访问：\r\n\r\n"
                + accountKey
                + "\r\n\r\n该 Key 已通过 Windows DPAPI 保护后保存在本机用户数据目录。",
                "大切课程表 - 首次运行", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            closing = true;
            trustMonitor.Stop();
            trustMonitor.Dispose();
            try
            {
                if (ownsBackend && backend != null && !backend.HasExited)
                {
                    backend.Kill();
                    backend.WaitForExit(5000);
                }
            }
            catch (Exception)
            {
                // 关窗阶段的清理失败无需打扰用户；Job Object 仍会兜底回收
            }
            if (job != null)
            {
                job.Dispose();
                job = null;
            }
            base.OnFormClosing(e);
        }
    }

    /// <summary>
    /// 最小化的 Windows Job Object 封装：设置 KILL_ON_JOB_CLOSE，句柄随外壳进程关闭时
    /// 由系统结束 job 内所有进程，避免外壳崩溃后残留 javaw.exe 占着端口。
    /// </summary>
    internal sealed class JobObject : IDisposable
    {
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JobObjectLimitKillOnJobClose = 0x2000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoType, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private IntPtr handle;

        internal JobObject()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero)
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Cannot create backend process job");
            }
            ExtendedLimitInformation info = new ExtendedLimitInformation();
            info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, buffer, false);
                if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, buffer, (uint)size))
                {
                    int error = Marshal.GetLastWin32Error();
                    Dispose();
                    throw new System.ComponentModel.Win32Exception(error, "Cannot configure backend process cleanup");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        internal void AddProcess(IntPtr processHandle)
        {
            if (handle != IntPtr.Zero && processHandle != IntPtr.Zero)
            {
                if (!AssignProcessToJobObject(handle, processHandle))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Cannot attach backend to process job");
            }
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                CloseHandle(handle);
                handle = IntPtr.Zero;
            }
        }
    }
}
