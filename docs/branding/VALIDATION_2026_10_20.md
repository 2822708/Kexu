# Kexu Validation — 2026-10-20

本记录对应 Kexu 品牌统一后的源码与重新构建的发行包。源码提交、文件大小和 SHA256 以各发行目录最终清单为准；旧发行文件及原始校验值通过固定 Git 历史查阅。

## Kexu Automated Checks

| 范围 | 本轮结果 |
| --- | --- |
| 共用前端 | 173 项回归全部通过；TypeScript 项目检查通过；ESLint 0 错误、7 条既有警告 |
| 构建 | 普通 Web、移动 PWA、原生 shell 三种构建成功；保留现有 Ant Design 大分块提示 |
| 云快照与部署 | 18 项全部通过，包括独立包运行、旧加密快照上传下载、重启持久化和私有路径隔离 |
| Java 后端 | 56 项测试通过；重新构建并检查当前 Web 资源 |
| 暂停的 Compose 工程 | 5 项单测通过；assembleDebug 和 Android instrumentation 测试源码编译通过，未执行设备测试 |
| Android shell | 5 项策略测试通过；发布 APK 构建并验签成功 |
| Windows shell | 31 项策略检查及最终两次隔离启动冒烟通过；测试任务保存、刷新和重启持久化通过 |

受限进程无法访问测试用 loopback 服务，Vite 也曾对当前源码返回 realpath EPERM；在相同源码上以正常进程重跑后通过。Windows 冒烟工具的就绪竞态修复限定在 `--smoke-test` 分支，最终两次通过结果来自修复后的工具。上述回归中的模拟 AI 服务不代表真实供应商质量或可达性。

## Kexu Compatibility

既有 IndexedDB 数据库和通知身份、PWA 安装身份、Android 应用 ID 与发布密钥保持稳定。兼容注册表集中识别既有偏好、恢复凭证和快照；新导出采用 Kexu 格式，解密旧快照时保留原始认证头。独立云发行包包含必需的 `shared/brandCompatibility.mjs`。

新版撤销语音同意会同时通知仍打开的旧版标签页；同意授权不会反向开启旧标签页。回归覆盖新键或旧键写入受阻时的独立撤销处理。Android CI 显式只安装所需 platform-tools，避免请求已移除的旧 tools 包，并使用 runner 已有 SDK 许可。

Android APK 使用应用 ID `com.kexu.local`，版本名 `2026.10.20.2`、版本号 `2026102002`，沿用此前发布密钥。签名证书 SHA256：

```text
74e5fa65a263abcfa3018b43813bb8eb13d6c9eb70498ea5cc5c1c9d37ccd332
```

Windows 使用系统 Evergreen WebView2；本机验证运行时版本为 `155.0.4283.62`。实际 GUI 中 Kexu 窗口正常显示，并保留前次创建于 2026-10-19 的合成验收任务“Windows封装验收任务”；[本轮窗口证据](evidence/kexu-windows-existing-task-20261020.png)记录该结果。该任务属于验收资料，不随发行包分发。

## Kexu Delivery Boundaries

- [PWA 运行包](../../releases/mobile/kexu-2026.10.20-brand/README.md)和[APK / Windows 便携包](../../releases/native/kexu-2026.10.20-native.2/README.md)携带当前公共资源，不包含用户数据库、开发缓存或签名私钥。
- APK 已构建与验签，尚无本轮 Android 真机安装、覆盖升级或系统文件选择器实测证据。Compose instrumentation 仅编译通过。
- Windows 便携包需要系统 WebView2；未附带 Fixed Runtime，也没有商业代码签名。
- 未完成生产 HTTPS 部署、手机 PWA 安装、真实 AI 供应商或原生云备份联调。原生虚拟 origin 不能充当云服务地址；远端服务必须另行配置允许的精确来源并验收。
- 核心数据继续先写本机。导出、导入与明确确认恢复用于不同浏览器、设备和外壳间迁移；清理网站数据、卸载 APK或删除 Windows Data 目录可能丢失本机资料。
