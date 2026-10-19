# 课序 Android 本地外壳

本工程将当前 `src/frontend` 的 `build:shell` 本地主数据版本装入 Android WebView；它与暂停中的 `src/android` Compose 工程无关。没有 Java 服务，也不把网页托管服务器作为数据主库。

- 应用标识：`com.kexu.local`；首个安装包版本 `2026.10.19` / `2026101901`。
- Android 8.0 / API 26 起；需要较新的 Android System WebView。界面、IndexedDB 和 WebCrypto 在固定 `https://appassets.androidplatform.net` origin 下运行。升级须保留应用标识、origin 和签名；卸载或“清除数据”会删除本机资料，请先导出。
- 外壳不自动读取浏览器PWA、旧Java桌面库或旧Compose应用的数据。需要在原端导出核心JSON，再从本应用的“本地数据与云快照”选择文件、预览并确认恢复。
- 课表、日任务、回顾离线保存在应用私有WebView数据目录。首次安装不需要联网下载界面。AI与云快照仍需要HTTPS和服务端CORS许可；此安装包不绕过浏览器的CORS或证书校验，也不代替云部署。

## 构建

在仓库根目录，使用已经接受许可并安装的SDK36、Build Tools36.0.0、Gradle8.13及JDK21：

```powershell
.\scripts\android-shell\Build-AndroidShell.ps1 -Release
```

默认工具根为 `E:\codex work\tools\android`，缓存、构建输出和签名材料均在E盘；可通过参数改工具/JDK路径。已构建网页可加 `-SkipWebBuild`，依赖齐备后可加 `-Offline`。脚本只清理经绝对路径验证的本工程生成资源目录。

- Debug：`app/build/outputs/apk/debug/app-debug.apk`。
- Release：`app/build/outputs/apk/release/app-release.apk`。
- Release签名密钥与口令配置：仓库忽略的 `work/private/android-shell/`，不可提交或公开上传；以后更新包必须复用它。不要覆盖已有密钥；另行离线备份整个私有目录。
- Debug与release的签名不同，不可直接互相覆盖安装；正式交付只使用release。
- `testDebugUnitTest`检查origin、路由、路径、文件名、长度和外链策略；它不能代替设备验收。

## 文件与网络安全边界

AndroidX WebViewAssetLoader 根路径映射只提供打包清单中的本地GET资源。仅已知前端路由回退到index.html；未知资源和目录穿越返回404。禁止file://、外部网页嵌入、任意主框架导航、混合内容和TLS绕过；外部HTTP(S)链接交系统浏览器。Release关闭WebView调试；系统权限请求默认拒绝，不申请存储、相机、麦克风权限。

JSON导出使用唯一的 `save-json` WebMessageListener消息，限定准确HTTPS origin及主框架，校验安全basename、请求ID、JSON结构和UTF8 11MiB上限。原生只向用户在系统“创建文档”确认的URI写入，不接受文件路径、不提供通用Java对象桥、不执行来自网页的JS文本。导入使用系统文件选择器，限定回传content://URI；仍由原有前端快照校验与人工恢复确认负责业务替换。

系统返回键先回到WebView历史；根页返回系统。刘海/导航条/输入法通过原生WindowInsets预留，不覆盖网页输入控件。界面重载和WebView崩溃不清空数据。专注计时的后台准时性、通知、语音识别不由此外壳新增保证。

## 设备验收清单

请在真机验证：首次断网启动、创建任务→杀进程重开→保留、完成撤销、回顾草稿、文件保存/取消/重新选择、JSON导入预览恢复、返回键、刘海与软键盘、系统200%字体，以及已有数据上覆盖升级。真实AI请求、跨域云快照、系统语音和应用后台行为需分别验证。未执行的项目不可标为通过。
