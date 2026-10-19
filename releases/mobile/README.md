# 手机端运行包

当前版本：[课序PWA 2026-10-19 preview.2](kexu-2026.10.19/README.md)，包含新UI和周课表遮挡修复，支持设备离线读写、自动加密快照和手动恢复。[旧本地preview.1](local-first-2026.10.18/README.md)保留。以下联网Java包是历史版本，业务数据仍在服务端。

## 2026-10-12历史联网包

开发验收版：2026-10-12。当前版本复用 Java 服务，手机课表、考试和待办需要联网。

- [下载 ZIP](TangentTimetable-mobile-online-2026-10-12.zip?raw=1)
- [启动说明](../../docs/mobile/ONLINE_2026_10_12.md)
- [部署与验证记录](../../docs/mobile/ONLINE_DEPLOYMENT_2026_10_12.md)
- [文件校验值](SHA256SUMS.txt)
- [发布清单](RELEASE_MANIFEST.json)

将 ZIP 解压到 E 盘，使用现有 Java 17 或以上版本启动 `tangent-mobile.jar`。包内已包含手机网页和 H2，不需要 Android SDK、Node、Maven 或 MySQL。

前端 26 项测试及真实 Java HTTP 接口 29 项检查通过。真机交互、PWA 安装、真实 AI 和文件数据库重启读写仍待验收；Java 测试 53 项中 52 项通过，1 项桌面备份测试受当前受限 Windows 进程的 H2 文件权限探测影响。

原生 Android 方案继续暂停。此目录提供可下载的开发验收包。
