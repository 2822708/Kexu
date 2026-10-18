# 本地主数据 PWA 运行包

版本 `2026.10.18-local-first-preview.1`，2026-10-18开发验收版。业务主库在设备IndexedDB；云只保存加密快照并发布文件。

- [下载ZIP](TangentTimetable-local-first-2026.10.18-preview.1.zip?raw=1)
- [SHA256校验](SHA256SUMS.txt)
- [发行与验收清单](RELEASE_MANIFEST.json)
- [使用说明](../../../docs/mobile/README.md)
- [完整验收记录](../../../docs/mobile/ACCEPTANCE_2026_10_18.md)
- [AI评测及优化](../../../docs/ai/EVALUATION_2026-10-18.md)

将ZIP解压到E盘普通目录，使用现有Node.js 20+运行，无需Java、Android SDK或npm install：

```powershell
node deployment/preview.mjs --data-dir "E:/Tangent-local-data"
```

本机打开 `http://127.0.0.1:17827`。启动入口仅监听本机；手机正式使用需另行部署可信HTTPS。不要双击index.html，也不要更换origin后误认为原数据丢失。

120项自动检查通过；包内45个文件CRC、SHA256及26个Web资源HTTP字节校验通过。浏览器已实际验证源码构建的离线读写、快照确认恢复和合成AI卡片；最终包的跨进程浏览器连接超时另行记录，未冒充通过。

**生产未部署**：远端SSH在身份认证前被关闭，未修改朋友服务器；独立Nginx/systemd/配额/回滚文件在包内。真实模型12语义项未运行（缺少专用连接与Key），物理手机/正式HTTPS安装仍待验收。

ZIP SHA256：`52849d33cd0d8d8f0c01e9d4549843dd5f84b835c5286ba774ab40f2dd6f9925`。源码提交：`266fa5aebc5de51774246164d00dfc3ccedf8c00`，打包时工作区干净。

包内不含真实课表、Key、恢复凭证或云数据。恢复确认会清空旧AI聊天；恢复凭证需单独保存。
