# Kexu APK & Windows EXE — 2026.10.20

两个应用随包携带最新 Kexu 本地页面，启动及核心课表、待办、日任务和回顾不需要 Java、Node 或在线网站。数据保存在各自设备和应用空间中。

- [Android APK](Kexu-Android-2026.10.20.apk)
- [Windows x64 完整便携包](Kexu-Windows-x64.zip)
- [发行清单](RELEASE_MANIFEST.json) · [SHA256](SHA256SUMS.txt)
- [本轮验证记录](../../../docs/branding/VALIDATION_2026_10_20.md) · [PWA 运行包](../../mobile/kexu-2026.10.20-brand/README.md)

## Kexu Android

Android 8.0 起，使用系统 WebView。安装 APK 后直接打开。应用 ID 仍为 `com.kexu.local`，版本为 `2026.10.20.2` / `2026102002`，沿用此前发布密钥；升级时覆盖安装，先卸载会删除应用本机资料。建议升级前导出核心 JSON。

发布 APK 构建、5 项外壳策略测试与签名验证通过；证书 SHA256 为：

```text
74e5fa65a263abcfa3018b43813bb8eb13d6c9eb70498ea5cc5c1c9d37ccd332
```

本轮尚未进行 Android 真机安装、覆盖升级和文件窗口验收。签名私钥与配置不在安装包或仓库中。

## Kexu Windows

完整解压到 E 盘，双击 `Kexu.exe`；同时保留 DLL 和 `app/` 等附属文件，不能只取出 EXE。需要系统 .NET Framework 4.8 和 Evergreen WebView2；本机测试的 WebView2 为 `155.0.4283.62`，包内不附带 Fixed Runtime，也没有商业代码签名。

程序默认将数据放在 EXE 旁 `Data/WebView2/`。也可使用 `kexu-data-dir.txt` 或 `--data-dir` 固定数据目录。更新时保留 Data，发行目录内不包含验收资料或用户数据。

31 项外壳策略检查和最终两次隔离启动冒烟通过，已验证测试任务保存、刷新和重启后保留。实际 Kexu 窗口还保留了此前 2026-10-19 创建的合成验收任务；详见验证记录中的截图。

## Kexu Data & Network

浏览器 PWA、APK、Windows EXE 和旧 Java 程序的数据互相隔离。迁移时从原端导出核心 JSON，再在目标端选择文件、检查预览并确认恢复。

AI 和云快照需另行配置 HTTPS 服务。原生页面来源为 `https://appassets.androidplatform.net`，不是云服务器地址；远端服务须允许准确的跨域来源。当前云服务默认按网页同源部署，本轮没有完成原生云备份或真实 AI 供应商联调。核心功能不依赖这些联网服务。
