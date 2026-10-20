# Kexu 2026.10.20.2 预览版

Kexu 本地版：课表、待办、今日任务与回顾，核心数据保存在设备上，打开应用无需 Java、Node 或网页服务器。

## 下载与安装

**[打开安装指南](https://github.com/2822708/Kexu/blob/fix/complete-optimization-plan/docs/install/README.md)**

- **[Android APK · Android 8.0+](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Android-2026.10.20.apk)**：下载后打开安装；已有版本请覆盖安装，不要先卸载或清除数据。
- **[Windows 便携包 · Windows 10/11 x64](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Windows-x64.zip)**：完整解压后运行 `Kexu.exe`；升级时保留 `Data` 文件夹和已有的 `kexu-data-dir.txt`。
- [SHA-256 校验文件](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/SHA256SUMS.txt) · [发行清单](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/RELEASE_MANIFEST.json)
- [独立 HTML 安装页](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Install.html) · [安装指南 Markdown](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/INSTALL.md)

当前仓库为私有仓库，下载需要登录获授权的 GitHub 账号。Windows 需要 .NET Framework 4.8 与 [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)；便携包没有安装向导，不能单独移出 EXE 运行。

## 本版内容

- 当前界面、源码、文档及安装包统一使用 Kexu 名称。
- 共享本地版课表、待办、今日任务、完成与撤销、回顾、草稿及 JSON 导入导出。
- Android 保持应用 ID `com.kexu.local` 与原发布签名，版本号 `2026102002`；旧快照、恢复凭据和本地数据保留兼容读取。
- Windows 默认数据保存在程序旁 `Data/WebView2`；整个文件夹可放在 E 盘。

## 验证与边界

前端、云快照、后端、Android 外壳策略及 Windows 策略检查通过；发行包已核对 ZIP 完整性、前端资源一致性、APK 签名和 SHA-256，且不包含私有数据或发布密钥。Windows 已完成两次启动及原有测试任务保留验证。

Android 真机、真实 AI 供应商与生产云服务尚未完成本次验收。AI 与云快照需要另行配置网络服务；原生云备份需要服务端开放准确来源的跨域访问并单独联调。不同设备的数据不会自动互通，迁移请导出 JSON 后在目标端预览并确认导入。
