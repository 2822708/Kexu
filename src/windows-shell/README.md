# Kexu Windows 本地版

这是最新本地主数据 PWA 的 Windows x64 外壳，使用 .NET Framework 4.8 与 Microsoft Edge WebView2。它不启动 Java、Node、localhost 服务，也不连接旧 Java 桌面数据库。

## 使用

1. 把整个 `Kexu-Windows-x64` 目录解压到可写位置，例如 `E:\Apps\Kexu`，双击 `Kexu.exe`。EXE、DLL 和 `app/` 必须放在一起。
2. 当前轻量包使用系统已安装的 WebView2 Runtime；没有安装时从 [微软官方下载页](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) 安装 Evergreen x64 Runtime。这不是一个无依赖单文件 EXE。若包内提供 `webview2-runtime/`，则使用该固定运行时。
3. 默认将主库、设置、AI 本机配置、浏览器缓存保存在同目录 `Data/WebView2/`。解压到 E 盘即可使这些数据也位于 E 盘。不把数据打入发行包。
4. 需要独立固定数据目录时，在 EXE 同目录创建 `kexu-data-dir.txt`，只写一行绝对路径，如 `E:\Kexu数据`；或用 `Kexu.exe --data-dir="E:\Kexu数据"`。同一目录只允许一个实例，不会自动迁移旧目录。
5. 升级前先从设置导出 JSON 备份，再关闭应用。保持原数据目录与固定 origin，替换程序文件，保留 `Data/` 或 `kexu-data-dir.txt`。不要删除 WebView2 用户数据目录来修复升级问题。

浏览器版与 EXE 版有不同的浏览器存储，第一次使用需要从浏览器导出 JSON 并在 EXE 内导入。旧 Java/H2 数据同样不会自动迁入。数据仍留在本机，云只用于用户配置的快照与更新。AI 直连能力受供应商 CORS 支持约束。

## 文件与权限

- 本地页面固定使用 `https://appassets.androidplatform.net`；导航只接受本应用路由，外部 HTTP(S) 用户链接交给系统浏览器。阻止框架、任意协议导航和网页下载。
- JSON 导出只提供 `save-json` 窄接口：核对顶层页面 origin、UUID、JSON 内容、文件名和 11 MiB 上限，随后由系统“另存为”窗口让用户确认。没有任意文件路径、执行命令或通用脚本接口。
- 导入沿用系统文件选取器，只有用户选中的文件交给页面。麦克风每次显式询问；其他网站权限默认拒绝。未提供后台通知服务。
- 程序 EXE 未用商业代码签名证书签名。系统安全提示不代表已有签名发行认证；请核对随包 SHA256。

## 开发和验证

前端先执行 `npm run build:shell`，显式 shell 模式生成本地主数据 `src/frontend/dist-shell`，无 Service Worker/manifest。然后运行：

```powershell
.\scripts\windows-shell\Build-WindowsShell.ps1 -OutputDir .\releases\native\new-build -SdkPackage E:\path\webview2.nupkg
.\scripts\windows-shell\Test-WindowsShellSmoke.ps1 -PackageDir .\releases\native\new-build\Kexu-Windows-x64
```

SDK 固定版本和 SHA256 见 `toolchain.json`。可选 `-FixedWebView2RuntimeDir` 指向官方展开后的 x64 Fixed Version Runtime，以随目录方式携带运行时。构建不删除旧输出；已有同名输出会停止。单元策略测试验证导航与导出边界，隔离冒烟实际启动两次，检查 React 页面、HTTPS secure context、真实日任务表单保存、逻辑路由刷新和 IndexedDB 跨启动保留。这些检查不能替代用户数据迁移、真实导入导出对话框、AI供应商、物理设备与系统字体验收。

Windows 虚拟域名映射直接读取 `app/index.html`；外壳在 React 启动前恢复允许的逻辑路由，F5刷新与深链也走同一入口。这不改变业务 origin 或数据目录。受限沙箱进程可能令 WebView2 的渲染/GPU进程立即退出，运行验收应在正常 Windows 桌面权限下进行；不得通过禁用 Chromium 沙箱绕过。

本地资源映射依据 [Microsoft WebView2 文档](https://learn.microsoft.com/microsoft-edge/webview2/concepts/working-with-local-content#virtual-host-name-mapping)。
