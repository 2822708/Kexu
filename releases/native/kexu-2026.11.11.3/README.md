# Kexu APK & Windows EXE（2026.11.11.3）

本版统一了启动画面与故障恢复：静态启动页、读取本机数据和首次路由加载都使用「圆圈 + 完美人生正在到来」；入口脚本或路由资源失败会显示「重新加载」；本机数据启动的初始化、维护和首读共用 15 秒上限。

- [Android APK](Kexu-Android-2026.11.11.3.apk) — 2026.11.11.3 / 2026111103
- [Windows x64 便携包](Kexu-Windows-x64-2026.11.11.3.zip)
- [交接报告](Kexu_启动页修复交接报告_2026-11-11.md)
- [源码补丁](0001-fix-make-mobile-startup-consistent-and-recoverable.patch)
- [发行清单](RELEASE_MANIFEST.json) · [SHA256](SHA256SUMS.txt)
- PWA 运行包：[`releases/mobile/kexu-2026.11.11.3-brand`](../../mobile/kexu-2026.11.11.3-brand/)

## 本版变化

- 启动页改用同源 `boot.js` 应用深色偏好，避免内容安全策略拦截内联脚本
- 静态启动、React 加载和路由加载共用同一画面，减少启动过程中画面跳变
- 入口脚本失败、路由资源失败、初始化事务挂起均有「重新加载」入口
- 本机数据初始化、维护和首读共用 15 秒上限；重试改为刷新页面，释放连接并保留数据
- 偏好存储被限制时回退默认字体和主题
- 保留 `.2` 的手机课表加长、地点/时间/日期显示和左右滑动

## 验证

- 本次复核：`typecheck` 通过，Lint 0 error；本地核心 26、课表布局 10、滑动 4 项测试通过
- 本机重新构建的 `dist-shell/index.html` 与 `boot.js` 和 APK、Windows 包内文件逐字节一致
- Windows 两次隔离启动冒烟通过，日任务跨启动保留；WebView2 `157.0.4341.46`
- PWA 包 51 个文件校验通过，`web/index.html` 与本机 mobile 构建一致
- 交接工作区另验证 6 个浏览器故障场景（慢加载、偏好存储受限、事务挂起、入口脚本 404、路由脚本 404、路由脚本挂起）
- 未做 Android 真机安装与覆盖升级；`deviceTested` 为 `false`

## 构建与来源

源码提交 `23aeb54`，基于报告提交 `338e2b3`，清单中 `sourceDirty` 为 `false`。
