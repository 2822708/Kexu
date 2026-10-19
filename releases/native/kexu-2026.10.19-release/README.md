# 课序 2026.10.19-native.1

- **Android**：把 `Kexu-Android-2026.10.19.apk` 发送到手机后安装。最低Android 8.0，需要较新的System WebView；包已使用本地发布密钥签名并通过验签，尚未真机安装验收。
- **Windows x64**：完整解压 `Kexu-Windows-x64.zip`，双击里面的 `Kexu.exe`。旁边的DLL和app目录必须保留；同时提供已解压的普通目录。需要.NET Framework 4.8和[微软WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)，本机已有Runtime155并通过两次真实启动验证。EXE没有商业代码签名。
- 建议把Windows整个目录放到E盘可写位置。数据默认在旁边的`Data/WebView2/`，升级保留Data；不要只从包里取出一个EXE。

课表、待办、日任务、完成反馈、回顾和草稿在本机离线运行，不需要Java/Node/localhost服务。APK/EXE和原浏览器的数据分开，首次迁移从原端导出核心JSON，在新端选择文件、检查预览并确认恢复。AI和云备份不是本次原生联调验收项；现有网页云服务需要精确CORS配置才能供外壳使用。

源码提交：`1a80759c05995dc96c10ad82e9c88fb6faf2640a`，文件树`ce83e7b5cd6d12d4f1b077984eee8a4130e62309`。Windows内部package-manifest保留构建当时的父提交及dirty标记，整体清单记录提交后的对应源码与文件摘要。包中没有测试profile、真实用户数据、恢复凭证或发布密钥。

[GitHub对应源码提交](https://github.com/2822708/Timetable/commit/a881f23a5f906d4d8a4bddedc22ba07935c2d00f)具有完全相同的文件树；[变更PR](https://github.com/2822708/Timetable/pull/5)保留为待审阅状态。

| 文件 | 字节 | SHA256 |
|---|---:|---|
| Kexu-Android-2026.10.19.apk | 3030691 | `86a300a994e7277db08293f62b0aab372fa62e48de12cb9d4fe2c31d40bbe5d3` |
| Kexu-Windows-x64.zip | 1395184 | `1698a5cfd29562507fb6eb43b8b529a4399667deb71280fda2ae1d021c440a7d` |

两端30个前端文件逐字节一致；Windows便携ZIP的39个文件与普通目录逐字节一致，ZIP完整性检查通过。前端165项、Android策略5项、Windows策略31项通过；Windows真实日任务保存、重启保留和路由刷新通过，系统另存为导出文件内容已核对。详细边界见仓库`docs/native/VALIDATION_2026_10_19.md`。

APK签名证书SHA256：`74e5fa65a263abcfa3018b43813bb8eb13d6c9eb70498ea5cc5c1c9d37ccd332`。后续安卓更新必须复用已有发布签名，不能先卸载；私有签名材料保存在开发仓库忽略的`work/private/android-shell/`，不随任何成品发布。
