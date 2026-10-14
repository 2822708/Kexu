# Windows 桌面版

桌面版由 WinForms + WebView2 外壳、嵌入 React 前端的 Spring Boot 独立包组成，使用本地 H2 数据库；默认监听 `127.0.0.1:17817`。当前构建与安全实现说明见 [优化说明](OPTIMIZATION.md)，完整工程优化状态见 [优化实施状态](../reviews/OPTIMIZATION_STATUS.md)。

## 本地构建

在项目根目录执行。构建机需使用 `src/desktop/toolchain.json` 指定的 JDK、Node/npm、C# 编译器和 .NET Framework。发行构建还需提供对应版本且有 Microsoft 签名的 Windows x64 WebView2 Fixed Version Runtime 文件夹。

```powershell
Set-Location -LiteralPath 'E:\codex work\projects\Tangent-Timetable'
powershell -ExecutionPolicy Bypass -File .\src\desktop\build-desktop.ps1 `
  -FixedWebView2RuntimeDir 'E:\tools\Microsoft.WebView2.FixedVersionRuntime.153.0.4234.48.x64' `
  -OutputDir '.\releases\windows-optimized'
```

脚本运行 `npm ci`、前端类型检查/lint/构建、standalone Maven verify、jlink、桌面外壳编译和隔离冒烟，然后才移动到新输出目录。它保留已有包，不会清理 `work/` 以外的文件，也不会访问 `%LOCALAPPDATA%\TangentTimetable` 中的真实数据。工具下载缓存和中间文件保存在仓库忽略的 `work/`。

没有 Fixed Runtime 时，可使用 `-AllowEvergreenRuntime` 构建开发包；清单会将其标为非发行验证。`-SkipSmokeTest` 也会将清单标为未验证。不要把这两种构建作为已验证发行版。输出目录已存在时脚本会拒绝覆盖，请为每次构建选择新的 `-OutputDir`。

检查包内清单和文件哈希：

```powershell
powershell -ExecutionPolicy Bypass -File .\src\desktop\verify-package.ps1 `
  -PackageDir '.\releases\windows-optimized\TangentTimetable' -RequireRelease
```

## 安全、账户和备份

桌面 Key 使用 Windows DPAPI `CurrentUser` 加密存储。旧版 `desktop-key.txt` 在迁移成功后移除；安装程序不会把 Key 放进 Java 进程命令行。桌面账号在首次空库初始化时通过本地引导流程建立为管理员，Web 部署共享配置仍由服务端角色控制。

WebView2 只访问准确的本地应用 origin。外部 HTTP(S) 链接交给系统浏览器；未授权的导航、iframe、新窗口和不属于本程序后端进程的本地监听都会被阻止。安全实现细节、边界和测试入口见 [优化说明](OPTIMIZATION.md)。

桌面设置页提供管理员备份、列表、下载和恢复前预览。归档中包含 H2 数据库与校验清单，不包含 DPAPI Key 文件。需要离线恢复时，先关闭桌面应用，再运行随包附带的 `tools/Restore-DesktopBackup.ps1`；预览确认后用归档显示的 SHA-256 作为 `-ExpectedSha256`，再显式传入 `-Apply`。请只对副本演练，恢复会替换当前数据库并保留替换前副本。

应用数据位于 `%LOCALAPPDATA%\TangentTimetable`。DPAPI 凭据绑定原 Windows 用户；换电脑或 Windows 账号时需重新建立凭据。不要把真实用户目录、账号文件、数据库或密钥提交到 Git。

## 验证边界

当前代码变更有后端 H2 回归测试、前端检查，以及桌面安全断言的既有通过记录。当前环境没有准备锁定版本的 Fixed Runtime，因此尚未生成或验收最终 Windows 发行包；也尚未在真实 MariaDB 部署或真实 DeepSeek 服务上做联调。具体状态以 [优化实施状态](../reviews/OPTIMIZATION_STATUS.md) 为准。
