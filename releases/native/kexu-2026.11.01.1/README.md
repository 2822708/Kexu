# Kexu APK & Windows EXE（2026.11.01.1）

此历史发行的两个应用随包携带当时的 Kexu 本地页面，启动及核心课表、待办、日任务和回顾不需要 Java、Node 或在线网站。数据保存在各自设备和应用空间中。

- [Android APK](https://github.com/2822708/Kexu/blob/f5efb4c4753d5a1d1c1f6eb8bcfd4738fbf0b8d8/releases/native/kexu-2026.11.01.1/Kexu-Android-2026.11.01.apk)
- [Windows x64 完整便携包](https://github.com/2822708/Kexu/blob/f5efb4c4753d5a1d1c1f6eb8bcfd4738fbf0b8d8/releases/native/kexu-2026.11.01.1/Kexu-Windows-x64.zip)
- [发行清单](RELEASE_MANIFEST.json) · [SHA256](SHA256SUMS.txt)
- 变更说明：[2026-11-01 交互修复与任务界面](../../../docs/design/UX_FIXES_2026_11_01.md)

## Kexu Android

Android 8.0 起，使用系统 WebView。安装 APK 后直接打开。应用 ID 仍为 `com.kexu.local`，版本为 `2026.11.01.1` / `2026110101`，沿用此前发布密钥；升级时覆盖安装，先卸载会删除应用本机资料。建议升级前导出核心 JSON。

发布 APK 构建时 5 项外壳策略测试通过，签名验证通过（APK Signature Scheme v2）；证书 SHA256 为：

```text
74e5fa65a263abcfa3018b43813bb8eb13d6c9eb70498ea5cc5c1c9d37ccd332
```

本轮未进行 Android 真机安装、覆盖升级和文件窗口验收。签名私钥与配置不在安装包或仓库中。

## Kexu Windows

完整解压到 E 盘，双击 `Kexu.exe`；同时保留 DLL 与 `app/` 等附属文件，不能只取出 EXE。需要系统 .NET Framework 4.8 与 Evergreen WebView2；本次验证所用 WebView2 为 `156.0.4314.58`，包内不附带 Fixed Runtime，也没有商业代码签名。

程序默认将数据放在 EXE 旁的 `Data/WebView2/`。也可使用 `kexu-data-dir.txt` 或 `--data-dir` 固定数据目录。更新时保留 Data，发行目录内不包含验收资料或用户数据。

31 项外壳策略检查与最终两次隔离启动冒烟通过，已验证日任务保存、刷新和重启后保留；包内 `app/index.html` 与 `dist-shell` 构建产物逐字节一致。ZIP 条目统一使用 `/` 分隔符，Windows 与 Linux 工具解压结果一致。

## 构建与来源

本包在干净工作区构建，源码提交为 `fb8b416`（清单中 `sourceDirty` 为 `false`）。构建命令与校验值见本目录 `RELEASE_MANIFEST.json` 和 `SHA256SUMS.txt`。

## Kexu Data & Network

浏览器、PWA、APK、Windows EXE 和旧 Java 程序的数据互相隔离。迁移时从原端导出核心 JSON，再在目标端选择文件、检查预览并确认恢复。

AI 和云快照需另行配置 HTTPS 服务。原生页面来源为 `https://appassets.androidplatform.net`，不是云服务器地址；远端服务须允许准确的跨域来源。当前云服务默认按网页同源部署，本轮没有完成原生云备份或真实 AI 供应商联调。核心功能不依赖这些联网服务。
