# 2026-10-19 APK / EXE 验收记录

范围是最新课序本地前端的 Android / Windows 外壳。旧 Java 桌面、暂停中的 Compose 应用没有参与构建，也没有读取其用户数据。

## 已验证

- 前端165项自动回归通过，含8项原生保存消息测试。新增的近7 MiB真实逻辑快照用例证明：导出不因格式化缩进增大而变得无法导入；不丢日活动历史。
- TypeScript编译和shell构建通过。shell显式启用本地模式，不注册Service Worker / manifest；普通PWA入口保留。Lint零错误，7条既有提示。
- Android使用JDK21、Gradle8.13、SDK36、AGP8.13.2，实际完成Debug/Release构建与5项Java策略测试，release lint通过。此前受限进程目录问题不再通过更换SDK绕开；正常Windows进程中AAPT2成功。
- Release APK：`com.kexu.local`，版本`2026.10.19` / `2026101901`，minSdk26，targetSdk36。APK Signature Scheme v2验签通过，RSA3072；证书SHA256 `74e5fa65a263abcfa3018b43813bb8eb13d6c9eb70498ea5cc5c1c9d37ccd332`。它是本机保存密钥的发布签名，没有Play商店发行记录。
- Windows编译与31项C#策略断言通过。在新建E盘隔离profile中实际运行最终程序两次：React页面、HTTPS安全上下文、IndexedDB、真实日任务保存、逻辑路由刷新、重启后的任务保留全部通过。运行时为系统WebView2 `155.0.4283.62`。
- 桌面映射实际打开EXE，新增“Windows封装验收任务”、标为完成；设置页通过系统另存为窗口将核心JSON写入E盘。读取导出文件确认日任务及`completed=true`。该窗口副本与最终包使用同一消息通道，最终包另外包含紧凑JSON修正和默认从数据目录打开保存窗口。
- Windows资源映射发现的真实问题已修正：虚拟目录映射不提供任意SPA路由回退，现从物理index.html加载并在React启动前恢复允许的逻辑路径；F5保持路由。WebView在首次窗口显示与DPI布局完成后初始化，避免控制句柄重建。
- 发行包不含Data、浏览器profile、恢复凭证或Android密钥。APK与Windows的内置前端由相同dist-shell生成，发布时另做逐文件字节与ZIP完整性核对，并记录SHA256。

## 未验证与使用边界

- 没有连接Android真机，也没有可用AVD/系统镜像；未声称完成APK安装、真机文件选择、刘海、键盘、系统大字体、进程回收或覆盖升级验收。Android 8.0起是构建最低版本，仍需较新的System WebView。
- Windows已验证此机器的Evergreen Runtime；未在无WebView2、新装Windows、不同字体/缩放或固定运行时机器验收。EXE未用商业代码签名证书签名。便携ZIP包含必要DLL和app目录，须完整解压。
- JSON导出通道做了实际Windows窗口验证；Android保存/导入及Windows原生文件导入预览没有在此次设备验收中执行。逻辑快照的导入、预览、恢复、迁移与越界行为有自动回归覆盖，不能等同设备验证。
- APK/EXE数据与原浏览器隔离。首次迁移需原端导出，再在目标端选文件、预览、确认；不会自动接管旧库。Windows保留Data，Android保持应用ID和发布签名，升级前先导出备份。
- 原生AI供应商、麦克风、生产HTTPS云备份未联调。现有云服务采用网页同源部署，原生需配置精确CORS来源；默认虚拟本地origin不是可用云服务器。不提供新增原生后台通知或计时保证。

构建机上的测试profile和导出文件只含本次合成测试数据，留在被Git忽略的work目录；不随成品交付。
