# 安装 Kexu

课表、待办与今日任务，保存在你的设备上。下载安装后，核心功能可以离线使用，无需安装 Java 或 Node。

**当前预览版：2026.10.20.2** · [发行说明与全部文件](https://github.com/2822708/Kexu/releases/tag/v2026.10.20.2)

| 设备 | 下载 | 大小 |
|---|---|---|
| Android 8.0 及以上 | **[下载 APK](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Android-2026.10.20.apk)** | 3.0 MB |
| Windows 10 / 11，64 位 | **[下载 Windows 便携包](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Windows-x64.zip)** | 1.4 MB |

当前仓库是私有仓库：下载前需登录有仓库访问权限的 GitHub 账号。遇到 404 时，先确认登录和访问权限。

## Android 安装

1. 在手机上下载 APK，下载完成后打开文件。
2. 若系统询问，允许当前浏览器或文件管理器安装此应用，然后完成安装。
3. 打开 **Kexu**，开始建立课表和今日任务。

**已有版本：直接覆盖安装，不要先卸载或清除应用数据。** 本版继续使用应用 ID `com.kexu.local` 和原发布签名。升级前建议在应用内导出 JSON 备份。

## Windows 使用

1. 下载 ZIP，**完整解压**到希望长期存放的位置，例如 `E:\Apps\Kexu`。
2. 在解压后的文件夹中双击 **Kexu.exe**。不要在压缩包内直接运行，也不要单独移出 EXE。
3. Windows 需要 .NET Framework 4.8 和 Microsoft Edge WebView2 Runtime。如果提示缺少 WebView2，请从 [Microsoft 官方下载页](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) 安装 **Evergreen Runtime**，再打开 Kexu。

这是便携版，没有安装向导。可右键 `Kexu.exe`，选择“发送到 → 桌面快捷方式”；Windows 11 可能需要先点“显示更多选项”。

**已有版本：先退出 Kexu，备份旧文件夹，替换程序文件时保留 `Data` 文件夹和已有的 `kexu-data-dir.txt`。** 默认数据位于程序旁的 `Data/WebView2`，所以程序放在 E 盘时，默认数据也在 E 盘。

## 数据、AI 与云备份

- 课表、待办和日任务首先保存在本机。Android、Windows 和浏览器的数据分别存储；跨设备迁移请在应用内导出核心 JSON，再在目标设备预览并确认导入。
- AI 与云快照需要单独配置网络服务。本包不附带 API 密钥；原生端云备份仍需要服务端跨域配置和单独联调。
- Windows 已完成本机两次启动及既有测试任务保留验证；APK 已完成构建、策略测试与签名校验，**尚未完成 Android 真机验收**。真实 AI 供应商和生产云服务未在本次包中验收。

## 校验文件

[下载 SHA256SUMS.txt](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/SHA256SUMS.txt) · [下载发行清单](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/RELEASE_MANIFEST.json)

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `Kexu-Android-2026.10.20.apk` | 3,031,359 | `e26cb28187e3b1fb7b2c818bee9dccb6b8a43610eb6645057650eaec8bca9ecc` |
| `Kexu-Windows-x64.zip` | 1,396,062 | `3165358355f3dca36c5883c495f429fcc33fd26affeec5be95c47275e9746579` |

[项目首页](https://github.com/2822708/Kexu) · [详细工程与迁移说明](https://github.com/2822708/Kexu/blob/v2026.10.20.2/docs/native/README.md) · [下载独立安装页 HTML](https://github.com/2822708/Kexu/releases/download/v2026.10.20.2/Kexu-Install.html)

独立 HTML 安装页下载后可直接用浏览器打开；GitHub 内的本指南就是当前可访问的安装页面，无需额外部署。
