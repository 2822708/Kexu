# 课序 · 本地主数据 PWA 运行包

版本 `2026.10.19-local-first-preview.2`，2026-10-19。包含新蓝绿界面、五项导航、今日时间线和周课表遮挡修复。课表与待办先保存在设备，云端只存加密快照。

- [下载ZIP](Kexu-local-first-2026.10.19-preview.2.zip?raw=1)
- [SHA256](SHA256SUMS.txt)
- [发行校验](RELEASE_MANIFEST.json)
- [界面落实与截图](../../../docs/design/UI_IMPLEMENTATION_2026_10_19.md)
- [使用说明](../../../docs/mobile/README.md)

本机交付的 `app/` 是可直接浏览的运行目录；GitHub只发布ZIP与清单。把ZIP解压到E盘普通目录，在解压根目录使用已有Node.js 20+执行：

```powershell
node deployment/preview.mjs --data-dir "E:/Tangent-local-data"
```

打开 http://127.0.0.1:17827 。无需Java、Android SDK、npm install。端口被占用时先检查归属，不停止其他应用。默认仅监听本机，手机正式使用需可信HTTPS部署。

固定使用相同地址、浏览器与用户配置。端口17827与开发预览5180是不同的数据空间；已有5180资料请继续使用原地址，或导出后在新地址预览并手动恢复。改名不清空或自动搬迁资料，不要清除网站数据。

130项自动检查通过（前端113、云10、部署7）。两种构建通过，Lint 0错误/7条既有警告。运行包48个ZIP条目CRC及逐字节核对通过；实际包健康检查、12个路由及29个Web资源HTTP字节核对通过。浏览器记录详见UI报告，手机尺寸模拟不代替物理手机。

源提交 `0fe3ebd0165d207419b44aba3127d96a1b26b235`，打包时工作区干净。ZIP SHA256：`5c89bf070ba782015583218c5604e18fa3e070f9dfe03324f7f5c49af6f5d0aa`。旧preview.1保留。未完成生产HTTPS/物理手机及真实模型质量验收；本包不是已上线站点或原生APK。包内不含真实课表、密钥、恢复凭证与快照数据，恢复凭证需单独保管。
