# Kexu APK 与 Windows EXE（2026-10-20）

[安装指南与 GitHub 下载](../install/README.md)提供 APK、Windows 完整便携包及升级步骤。

[下载安装包与SHA256](../../releases/native/kexu-2026.10.20-native.2/README.md)。本机普通便携目录另放在项目空间的 `releases/native/kexu-2026.10.20-native.2/`，不含开发依赖或测试数据。

本次把最新本地主数据前端封装为 Android 安装包和 Windows 便携程序。课表、待办、日任务、完成撤销、回顾和草稿共用现有 IndexedDB 业务逻辑；界面资源随包携带，打开应用不需要 Java 服务、Node 或网页服务器。AI 和云快照需要另外配置 HTTPS 服务，且服务端必须允许来自 `https://appassets.androidplatform.net` 的跨域请求。

仓库当前云服务按网页同源部署设计，没有为外壳开放跨域响应。本次包以离线功能与JSON交换为交付范围；原生云备份需要后续配置精确来源的CORS网关并单独联调，不能直接把虚拟本地地址当作云服务器。真实AI供应商与云服务未在此次包中验收。

## 工程边界

| 目录 | 用途 |
|---|---|
| `src/frontend` | React 共用界面与本地业务；`npm run build:shell` 生成 `dist-shell/` |
| `src/android-shell` | Java Activity、AndroidX WebViewAssetLoader、安全 JSON 导出与系统文件选择 |
| `src/windows-shell` | .NET Framework 4.8 / WinForms / WebView2 本地资源外壳 |
| `scripts/android-shell` | Android 构建、测试及本机签名材料初始化 |
| `scripts/windows-shell` | Windows 编译、便携包、策略检查和隔离启动测试 |
| `releases/native` | 生成的 APK、EXE 便携目录、ZIP、校验与验收清单 |

暂停中的 `src/android` Compose 方案和旧 `src/desktop` Java 服务外壳继续保留；它们不参与本次打包。普通网页和 PWA 的构建入口保持原有行为。

## 本地存储与升级

两个外壳都固定使用 HTTPS 虚拟 origin。Android 数据保存在应用私有 WebView 目录，Windows 默认保存在 EXE 旁 `Data/WebView2/`；Windows 整个程序目录放在 E 盘时，这些数据也在 E 盘。Windows 可用 `kexu-data-dir.txt` 或 `--data-dir` 指定固定目录。Android 私有数据位置由手机系统管理。

浏览器 PWA、APK、Windows EXE 和旧 Java 程序的数据互相隔离。迁移时先从原端导出核心 JSON，在目标端选取文件、检查预览并确认恢复。不要依靠复制浏览器缓存迁移。升级前保留备份；Windows 替换程序文件时保留 Data，Android 覆盖安装须保持应用 ID `com.kexu.local` 和同一发布签名，不能先卸载。

Android 发布密钥与配置保存在固定的本机工具目录 `E:\codex work\tools\android\signing\Kexu\`，不随源码、安装包、备份或 GitHub 发布。构建复用迁移后的既有发布密钥，不以新密钥替代；后续更新仍需复用并另行离线备份它们。当前品牌版 APK 使用版本 `2026.10.20.2` / `2026102002`。Windows 当前便携包没有商业代码签名，使用系统 Evergreen WebView2 Runtime；它由 EXE、DLL、app 资源等共同组成，不能只取出 EXE。

## 资源和文件通道

原生构建明确开启本地模式，禁止混入 PWA 的 Service Worker 和 manifest。已知路由由外壳回退到 index.html；本地资源和业务不依赖网络。外部用户链接交系统浏览器，页面没有执行命令、任意路径读写或通用 Java 对象桥。

JSON 导出协议只含 `type/id/filename/text`，准确校验 origin、主页面、请求 ID、JSON 和 11 MiB UTF-8 上限，再由系统保存窗口选目标。实际写入成功才反馈成功；取消不把私有恢复凭据标记为已导出。导入继续使用系统文件选择器和现有业务校验。网页普通模式继续使用浏览器下载。

实现参考：[AndroidX WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)、[WebViewCompat WebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat)、[WebView2 本地资源映射](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)。

## 构建与验收

前端先运行 `npm ci` 和 `npm run build:shell`，再使用两个外壳目录各自 README 中的命令。工具缓存、构建目录、Android 签名材料和交付目录默认留在 E 盘；不会修改全局环境或旧程序数据。

每次交付应记录源码提交、APK 签名验证、发行文件 SHA256、前端资源一致性、测试结果及未执行的设备验收。策略单测和浏览器测试不能代替 APK 真机、Windows 原生文件窗口、覆盖升级、AI 真供应商或生产云服务验收。本次重建结果以当前发行目录的清单为准；`VALIDATION_2026_10_19.md` 保留此前外壳验收边界。
