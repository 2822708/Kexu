// 大切课程表 —— Windows 桌面外壳（.NET Framework 4.8 + WebView2）
//
// 职责：
//   1. 单实例：已有实例在跑就直接提示退出
//   2. 本机账号：首次运行生成一个随机 API Key 存在数据目录，之后自动登录，用户无需手输
//   3. 启动内置后端（jlink 裁剪运行时 + Spring Boot fat jar），数据落在 %LOCALAPPDATA%
//   4. 用 WebView2 打开界面（无地址栏，就是桌面应用的样子）
//   5. 关窗时结束后端进程；并用 Job Object 保证外壳异常退出时子进程也被系统回收
//
// 为什么外壳要管账号：应用本身没有注册页，账号是 api_key 表里的一行，服务端在表为空时
// 会随机生成并只打印到日志 —— 桌面用户看不到日志。所以外壳自己生成 Key、持久化、并注入
// WebView 的 localStorage 实现自动登录；首次运行时把 Key 显示出来，便于在其它设备使用。
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
        private static void Main()
        {
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
                Application.Run(new MainForm());
                GC.KeepAlive(mutex);
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly WebView2 webView = new WebView2();
        private readonly string dataDir;
        private string keyFile;
        private string accountKey;
        private bool freshAccount;
        private Process backend;
        private bool ownsBackend;
        private JobObject job;

        internal MainForm()
        {
            this.Text = "大切课程表";

            // 窗口内容只有一个 Dock 填充的 WebView2，不需要 WinForms 自动缩放布局；
            // 尺寸在 OnLoad 里按窗口实际 DPI 换算，避免与 AutoScaleMode 重复缩放。
            this.AutoScaleMode = AutoScaleMode.None;
            this.StartPosition = FormStartPosition.CenterScreen;

            this.webView.Dock = DockStyle.Fill;
            this.Controls.Add(this.webView);

            this.dataDir = Path.Combine(
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
                EnsureAccountKey();
                StartBackendIfNeeded();
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "大切课程表 - 启动失败",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
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
            keyFile = Path.Combine(dataDir, "desktop-key.txt");
            if (File.Exists(keyFile))
            {
                accountKey = File.ReadAllText(keyFile).Trim();
            }
            if (accountKey == null || accountKey.Length == 0)
            {
                accountKey = GenerateKey();
                freshAccount = true;
                File.WriteAllText(keyFile, accountKey);
            }
        }

        private static string GenerateKey()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            StringBuilder sb = new StringBuilder(64);
            for (int i = 0; i < bytes.Length; i++)
            {
                sb.Append(bytes[i].ToString("x2"));
            }
            return sb.ToString();
        }

        /// <summary>端口上已有服务就直接复用；否则启动内置后端并等它就绪。</summary>
        private void StartBackendIfNeeded()
        {
            if (IsServerUp())
            {
                ownsBackend = false;
                return;
            }

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
                + " --app.bootstrap-key=" + accountKey
                + " --server.port=" + Program.Port;

            ProcessStartInfo psi = new ProcessStartInfo(java, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = baseDir;

            backend = Process.Start(psi);
            ownsBackend = true;
            // 外壳被强杀时，靠 Job Object 让系统一并回收后端进程
            job = new JobObject();
            job.AddProcess(backend.Handle);

            WaitForServer();
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
                if (IsServerUp())
                {
                    return;
                }
                Thread.Sleep(300);
            }
            throw new TimeoutException(
                "后端启动超时。\r\n日志：" + Path.Combine(dataDir, Path.Combine("logs", "timetable.log")));
        }

        /// <summary>能拿到任何 HTTP 响应（含 401/404）都说明服务已监听。</summary>
        private static bool IsServerUp()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Program.Port + "/");
                req.Method = "GET";
                req.Timeout = 2000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException ex)
            {
                return ex.Response != null;
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
                    await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                await this.webView.EnsureCoreWebView2Async(env);

                CoreWebView2Settings settings = this.webView.CoreWebView2.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.IsZoomControlEnabled = true;

                // 自动登录：在文档创建前写入前端读取的那两个 localStorage 键
                string script =
                    "try{"
                    + "localStorage.setItem('timetable.apiKey','" + accountKey + "');"
                    + "localStorage.setItem('timetable.apiLabel','管理员');"
                    + "}catch(e){}";
                await this.webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);

                this.webView.Source = new Uri("http://127.0.0.1:" + Program.Port + "/");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "无法初始化 WebView2 组件：\r\n\r\n" + ex.Message
                    + "\r\n\r\n请先安装 Microsoft Edge WebView2 Runtime（Win10/11 通常已自带）。",
                    "大切课程表", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        /// <summary>首次运行时把本机账号 Key 显示一次，便于在其它设备（小组件/手机）使用。</summary>
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            // 放在 OnShown 而不是 OnLoad：WinForms 首次显示时会再缩放一次窗口尺寸
            ApplyPhysicalWindowSize();
            if (!freshAccount)
            {
                return;
            }
            bool copied = false;
            try
            {
                Clipboard.SetText(accountKey);
                copied = true;
            }
            catch (Exception)
            {
                // 剪贴板被其它程序占用时不阻断启动
            }
            MessageBox.Show(
                "已为你创建本机账号，并已自动登录，无需手动输入。\r\n\r\n"
                + "如需在其它设备（iPad/手机小组件、其它浏览器）使用，API Key 为：\r\n\r\n"
                + accountKey
                + (copied ? "\r\n\r\n（已复制到剪贴板）" : "")
                + "\r\n\r\n该 Key 也保存在：" + keyFile,
                "大切课程表 - 首次运行", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
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

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
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
                return;
            }
            ExtendedLimitInformation info = new ExtendedLimitInformation();
            info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
            int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, buffer, false);
                SetInformationJobObject(handle, JobObjectExtendedLimitInformation, buffer, (uint)size);
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
                AssignProcessToJobObject(handle, processHandle);
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
