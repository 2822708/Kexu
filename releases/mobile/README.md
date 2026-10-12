# 联网手机首版运行包

开发验收版：2026-10-12。当前版本复用 Java 服务，手机课表、考试和待办需要联网。

- [下载 ZIP](TangentTimetable-mobile-online-2026-10-12.zip?raw=1)
- [启动说明](../../docs/mobile/README.md)
- [部署与验证记录](../../docs/mobile/DEPLOYMENT.md)
- [文件校验值](SHA256SUMS.txt)
- [发布清单](RELEASE_MANIFEST.json)

将 ZIP 解压到 E 盘，使用现有 Java 17 或以上版本启动 `tangent-mobile.jar`。包内已包含手机网页和 H2，不需要 Android SDK、Node、Maven 或 MySQL。

前端 26 项测试及真实 Java HTTP 接口 29 项检查通过。真机交互、PWA 安装、真实 AI 和文件数据库重启读写仍待验收；Java 测试 53 项中 52 项通过，1 项桌面备份测试受当前受限 Windows 进程的 H2 文件权限探测影响。

原生 Android 方案继续暂停。此目录提供可下载的开发验收包。
