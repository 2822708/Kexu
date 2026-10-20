# 桌面安全、构建与交付

本文描述优化分支的源码行为。旧的 `releases/windows/Kexu` 是历史交付物，不会因为源码改变而自动更新。是否可交付，以新包的 `release-manifest.json` 和真实冒烟结果为准。

## 本机信任边界

- 后端显式绑定 `127.0.0.1:17817`。启动前端口探测拒绝已占用端口；启动后通过 Windows `GetExtendedTcpTable` 确认该 loopback 监听器属于刚创建的 Java 进程，才发送账号验证请求和打开 WebView。通配地址监听器、其它 PID、已退出进程均不被接受。
- WebView 顶层导航只允许 `http://127.0.0.1:17817/`，拒绝其它协议、主机别名、端口和 userinfo。所有 iframe 导航被取消；新窗口仅在用户主动操作时交给系统浏览器，且只允许 HTTP(S)。Web 资源请求也检查 origin 和后端进程所有权。
- 自动登录脚本再次检查精确 origin 和 `window.top === window`。旧版凭据以 JavaScript 字符串数据转义，避免特殊字符变成脚本。账号不会注入子框架或外部页面；开发者工具与原生 host object 被禁用。
- 后端退出或监听器所有权变化时关闭 WebView；Job Object 负责外壳异常退出时终止所属 Java 子进程。清理不会按进程名杀死其它 Java 程序。
- 这些措施防止错误端口复用和外部页面获得凭据。同一 Windows 用户权限下的恶意软件仍可以读取该用户进程或浏览器配置；本地进程权限不是可防御同权限攻击者的隔离边界。

## 麦克风权限

WebView2 默认拒绝麦克风以外的浏览器权限。只有来自本产品精确本地 origin、由用户手势发起且归属本产品后端的麦克风请求才会获准；应用内语音按钮还要求用户先勾选语音识别说明。Windows 麦克风隐私设置或在线语音识别服务仍可能导致系统提示或拒绝，用户可以随时改用手动输入。浏览器默认语音识别可能会将录音发送到在线服务，前端因此在启动前说明这一点。

## 凭据与恢复

本机账号保存在 `desktop-key.dpapi`，使用 Windows DPAPI `CurrentUser` 加密。旧 `desktop-key.txt` 首次读取后原子写入保护文件，再删除明文；若上次恰好中断在写入之后，下次启动会清理与保护文件内容相同的旧明文。损坏文件不会被静默替换为新账号。

账号和本地 AI 设置加密材料通过 Java 子进程环境变量传递，不出现在 Java 命令行中。首次运行显示恢复凭据，提示用户保存在密码管理器中，不再自动复制到系统剪贴板。本机服务只供当前电脑访问，不再暗示手机可以直接使用 loopback 服务。

数据恢复使用包内 `tools/Restore-DesktopBackup.ps1`：先预览校验，关闭应用，再使用预览中明确的归档 SHA256 执行恢复。恢复工具创建 `.restore-in-progress` 标记期间，外壳拒绝启动，避免 H2 文件替换过程中再次打开数据库。具体备份格式和恢复流程以该脚本及数据安全文档为准。DPAPI 与原 Windows 用户绑定；跨用户迁移不能只复制加密凭据文件。

## 构建输入与命令

`src/desktop/toolchain.json` 固定当前构建基线：Microsoft JDK 21.0.7、Node 22.23.2、npm 10.9.8、C# 编译器 4.8.9221.0、WebView2 SDK 1.0.4191.47、Fixed Runtime 153.0.4234.48；运行最低要求为 .NET Framework 4.8。这是工程基线，升级依赖时应在同一变更中更新版本锁并重跑相关交付检查，不代表长期冻结安全更新。

SDK SHA256 为 `f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0`。本次从 NuGet 官方固定地址下载并计算过该值。构建只接受该包哈希，不再查询“最新版本”，也不会信任未经检查的已解压缓存。

发布构建需要准备微软分发的对应 **Windows x64 Fixed Version Runtime**，解压后的目录直接包含 `msedgewebview2.exe`。脚本核对确切版本和 Microsoft Authenticode 签名，并把完整运行时放入 `webview2-runtime`；WebView 优先使用包内该目录。Runtime 的实际输入可执行文件及全部产物都会记录 SHA256。没有取得微软 Fixed Runtime 原始 CAB 的已验证发布哈希，因此不把系统安装目录冒充已核验的发布归档。

```powershell
Set-Location -LiteralPath 'E:\codex work\projects\Kexu'
powershell -ExecutionPolicy Bypass -File .\src\desktop\build-desktop.ps1 `
  -FixedWebView2RuntimeDir 'E:\tools\Microsoft.WebView2.FixedVersionRuntime.153.0.4234.48.x64' `
  -OutputDir '.\releases\windows-optimized'
```

本机开发可显式选择 `-AllowEvergreenRuntime`，复用已安装的 WebView2 Runtime。该模式会记录实际运行时版本，但 `releaseVerified` 必为 `false`，不会混同于固定运行时发布构建。`-SkipSmokeTest` 同样明确标记为未验证开发包。所有已有输出目录均被保留，输出已存在时需要选择新目录。

构建顺序为：版本核对 → `npm ci` → 前端 typecheck/lint/build → 后端 `mvnw.cmd -B -ntp verify -Pstandalone` → jlink → 校验和解压 SDK → C# 编译 → 隔离数据冒烟 → 写入清单 → 移动到指定输出目录。失败的中间结果留在仓库 `work/desktop-build` 下，便于诊断；不会打开 `%LOCALAPPDATA%\Kexu` 的真实数据。

`release-manifest.json` 包含 Git HEAD、工作区是否有未提交改动、工具链配置哈希、编译器与 jlink 哈希、前端 lockfile 哈希、验证范围和全部产物的大小/SHA256。它提供追踪和完整性检查；传统 .NET Framework 编译器的时间戳意味着本方案不声称二进制逐字节可重现。

```powershell
powershell -ExecutionPolicy Bypass -File .\src\desktop\verify-package.ps1 `
  -PackageDir '.\releases\windows-optimized\Kexu' -RequireRelease
```

校验器拒绝缺失、额外、哈希变化、重复和越出包目录的文件。清单本身未做代码签名，因此不能替代可信下载来源或发布签名。

## 验证证据与尚未完成的交付门槛

2026-09-27，本次源码已通过 .NET Framework 编译。已执行的原生回归包含 35 条断言：精确 origin、协议/别名/端口/userinfo 拒绝、真实进程监听器归属、其它 PID/退出进程/通配监听/端口占用、DPAPI 往返及旧凭据迁移中断恢复；另有 5 个 JavaScript 上下文用例检查顶层/子框架/origin 和带引号、换行符的旧凭据转义。结果位于仓库忽略目录 `work/desktop-tests`，这些测试只使用合成数据。后续仅因改动相关逻辑或出现失败时重跑相应用例。

```powershell
powershell -ExecutionPolicy Bypass -File .\src\desktop\test-desktop-security.ps1
powershell -ExecutionPolicy Bypass -File .\src\desktop\test-desktop-smoke.ps1 `
  -PackageDir '.\releases\windows-optimized\Kexu'
```

冒烟工具使用全新 `work/` 数据目录与 `--smoke-test --data-dir=...` 参数，隐藏启动实际外壳，核对后端账号就绪、WebView 页面/自动登录、DPAPI 文件和退出后所属后端清理。它不会复用或终止已有 17817 服务。原生 helper/脚本测试证明信任策略，不能替代实际 WebView 外部导航、固定运行时分发及完整前后端打包检查。

截至本文编写时，完整发布包尚待前后端稳定后统一构建与冒烟；Fixed Version Runtime 分发输入尚未完成下载校验。已编译与单元回归的源码不能称为已验证的新发布包。
