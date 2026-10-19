# 课序 · 日任务运行包

版本 `2026.10.19-daily-preview.3`，2026-10-19。已接入真实本地日计划、重点、临时/补记任务、完成特效与撤销、回顾和独立草稿；底部日程/专注/回顾收成一行。

- [下载ZIP](Kexu-2026.10.19-daily-preview.3.zip?raw=1)
- [SHA256](SHA256SUMS.txt) · [发行清单](RELEASE_MANIFEST.json)
- [功能、实际截图与验收](../../../docs/design/DAILY_TASKS_IMPLEMENTATION.md)

本机交付同时保留普通目录 `app/`，无需只用压缩包。解压ZIP到E盘普通目录，在解压根目录使用Node.js 20+运行：

```powershell
node deployment/preview.mjs --data-dir "E:/Tangent-local-data"
```

打开 `http://127.0.0.1:17827`，无需Java、Android SDK或npm install。已有网站数据应在同一origin升级，或先导出文件后在新地址预览恢复。不同端口、域名或浏览器的数据不自动搬迁，不要清除网站数据。

本机schema升级为2并保留原始v1迁移恢复值。新快照v2包含日任务/事件/回顾草稿，旧v1明文和密文仍能手动恢复；加密信封、恢复密钥及历史标识保持。首次升级应关闭旧标签并加载新版本。

157项前端测试、7项部署测试通过，手机与桌面Web构建通过，Lint零错误/7条既有提示。ZIP52项CRC及逐文件字节相等检查通过；实际包健康检查、8个路由与33个Web资源HTTP字节核对通过。确认本机预览服务连接被拒绝后，浏览器PWA重开、日任务新增/刷新保留、完成与回顾通过。

源本地提交 `638814f9eaefdda1758fba07cc92805a32bcc502`，源文件树 `40a37bd2b3b5fd6b31a2eb1bf6abcd4813b1f2f1`，构建时工作区干净。通过GitHub接口发布可能产生不同的提交ID，以相同文件树核对源码。ZIP SHA256：`6e33011f7c90db7c4a613976640f43dff9db15f66454191ff5c76616cea2eefa`。

这是本地PWA运行包，不是原生APK或已上线站点。未完成物理手机、200%系统字体、生产HTTPS升级与真实模型质量验收。包内不包含测试浏览器的数据、真实课表、密钥、云恢复凭证或用户快照。
