# 联网手机首版部署

> 2026-10-18 用户已确认云只承担快照存储与应用发布下载，业务主数据留在设备，自动备份且恢复手动确认。[新架构约定](LOCAL_DATA_CLOUD_SNAPSHOTS.md) 取代本文作为后续目标；本文命令仍仅描述旧联网包，不应据此把 Java/H2 课表主库部署到云端并宣称符合新要求。

更新：2026-10-12。用户确认首版以 1–2 天内快速交付为目标，允许课表、待办和考试依赖 Java 服务联网读写。原生 Android 方案保持暂停。

## 交付边界

复用 React 18 / Ant Design 和现有 Java REST/SSE API。手机界面与桌面共用业务规则；`npm run build:mobile` 才生成 PWA manifest、图标与 Service Worker。普通 `npm run build` 保留桌面构建，不注册移动 PWA。

业务接口 `/api/**` 不缓存、不离线排队。断网后只能打开已缓存的页面外壳，核心业务需要恢复网络。设备身份目前保存在各浏览器自己的 localStorage；新浏览器、新手机或清理网站数据会建立新的独立空间。本首版没有桌面与手机账号同步、后台提醒、系统小组件和离线编辑。AI 提案仍逐条确认后才能改数据。

## 最短可运行方式

使用 standalone Maven profile 可避免安装 MySQL：它把 H2 加入运行依赖，并将前端 `dist` 打进同一 JAR。Java 同时提供页面和 `/api`，手机始终访问一个站点。用于受控演示的 Java 服务、H2 文件库和日志均可放在 E 盘；长期多人服务再按账号与同步方案部署独立 MySQL。

以下命令从当前 Git checkout 根目录执行。Node 需满足锁定 ESLint 的要求（`^20.19.0 || ^22.13.0 || >=24`），Java 编译目标为 17，已有 Microsoft JDK 21 可运行。不要从原 Windows 桌面程序的数据目录启动这个服务。

```powershell
$project = (Get-Location).Path
$mavenCache = Join-Path $project 'work\maven-repository'

Set-Location -LiteralPath (Join-Path $project 'src\frontend')
npm ci
npm run typecheck
npm run lint
npm run build:mobile

Set-Location -LiteralPath (Join-Path $project 'src\backend')
.\mvnw.cmd -B -ntp "-Dmaven.repo.local=$mavenCache" -Pstandalone verify

$dataDir = 'E:/Tangent-Mobile/data'
java -jar .\target\timetable-backend-1.0.0.jar `
  --spring.profiles.active=standalone `
  --server.address=127.0.0.1 --server.port=17827 `
  "--app.data-dir=$dataDir" `
  --app.security.allow-local-ai-key-settings=false `
  --app.backup.enabled=false
```

`standalone` 默认绑定 `127.0.0.1:17817`，上面的参数明确覆盖为反代使用的 `127.0.0.1:17827`。命令行参数优先于 `application-standalone.yml`。H2 文件库、日志、本地设置都使用显式的新目录；该服务不读取 `%LOCALAPPDATA%\TangentTimetable` 的用户数据。

前端 API 默认 `/api`，同源部署不需要更换认证。当前认证头是 `X-API-Key`，不是 Cookie；无需为了手机首版新增 JWT 或改登录协议。设备自动注册为普通用户，不自动获得管理员权限。

未配置模型密钥时，普通业务仍可使用，AI 状态为未启用。需要 AI 时由部署者在服务进程的本地环境中设置 `DEEPSEEK_API_KEY`，不要写入前端、Git、命令示例或日志。本服务明确禁用桌面本地密钥设置；不要把桌面的 Key 设置界面当成服务器配置方式。

## 手机和 HTTPS

PWA 安装和 Service Worker 要求安全上下文。电脑上的 `localhost` 可以开发，但手机访问 `http://电脑IP` 不等于手机自己的 localhost，不能保证 PWA 安装。

已有域名、可信证书和服务器时，用 [Nginx 模板](nginx-mobile.conf.example) 提供 `https://你的域名`，前端静态文件位于同一站点，`/api` 反代到 Java。模板要填写实际域名、静态目录和证书路径，再由部署者验证配置。它不是本轮已经部署的线上站点。

模板特意保留三个条件：

1. React 深链回退到 `index.html`；`/api` 保持完整路径转发，不把 API 404 回退成网页。
2. API 关闭代理缓存和响应缓冲，使用 HTTP/1.1，读取超时 300 秒，保留 AI 的 POST SSE 增量输出。
3. `sw.js`、manifest 和 `index.html` 需要重新验证或禁止缓存；带内容 hash 的 `/assets/` 才使用 immutable 长缓存。发布时保留旧版本带 hash 的资源一段时间，避免仍打开的旧页面加载动态模块失败。新版本由页面提示用户确认更新。

首次上线前实际验证 `https://域名/api/auth/device` 可以响应；安卓 Chrome 通过安装入口添加主屏幕，iOS Safari 使用分享菜单“添加到主屏幕”。不要在公网直接使用旧文档的无缓冲控制 Nginx 片段，也不要跳过证书信任验证。受控演示入口和未来公网多用户服务是不同的部署范围；后者沿用后续账号与同步方案。

仅要先演示浏览器界面时，可暂时把 Java 启动参数改为 `--server.address=0.0.0.0`，在同一网络访问 `http://电脑IP:17827`。这只提供联网网页演示，不视为 PWA 安装验收。开通机器防火墙或正式公网入口由实际部署环境决定。

## 开发预览连接隔离后端

```powershell
Set-Location -LiteralPath (Join-Path $project 'src\frontend')
$env:VITE_DEV_API_TARGET = 'http://127.0.0.1:17827'
npm run dev -- --host 127.0.0.1
```

`npm run preview` 也使用同一代理变量，需在启动命令之前设置它。前端 5173/4173 与 Java 17827 分开，浏览器仍通过前端站点的 `/api` 请求 Java。

## 重跑真实 HTTP API 冒烟

[smoke-api.mjs](../../scripts/mobile/smoke-api.mjs) 只允许 `http://127.0.0.1:17827` 或 `http://localhost:17827`，生成两个临时随机设备身份，测试自己创建的记录并按 ID 清理。它不接受真实服务器 URL，也不清空表。测试身份由一次性数据库销毁；不要给此测试配置真实用户数据库。

从根目录另开一个终端，显式启动内存数据库和新的设置目录。以下实例 AI 关闭，避免读取或使用任何真实模型密钥；关闭备份，日志也位于新目录。

```powershell
$project = (Get-Location).Path
$testData = Join-Path $project ('work\mobile-api-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testData | Out-Null
$testData = $testData.Replace('\', '/')
java -jar (Join-Path $project 'src\backend\target\timetable-backend-1.0.0.jar') `
  --spring.profiles.active=standalone `
  --server.address=127.0.0.1 --server.port=17827 `
  "--app.data-dir=$testData" `
  '--spring.datasource.url=jdbc:h2:mem:mobile_pwa;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1' `
  --app.bootstrap-key= --app.admin-api-keys= `
  --app.security.allow-local-ai-key-settings=false `
  --app.backup.enabled=false --deepseek.api.key=your-deepseek-api-key
```

服务显示 started 后，在另一终端根目录执行：

```powershell
node .\scripts\mobile\smoke-api.mjs http://127.0.0.1:17827 .\work\mobile-api-smoke.json
```

检查自动身份、课表/课程/待办/考试 CRUD、待办完成、考试待办新增/修改/删除联动、缺失认证与跨账号访问拒绝。JSON 报告不输出身份凭据。真实 DeepSeek 请求、SSE、HTTPS 域名部署和手机实测需单独验收，不能从这份 API 报告推断已完成。

当前数据库升级使用 Flyway，H2 迁移位于 `src/backend/src/main/resources/db/migration/h2`，MySQL 使用 `db/migration/mysql`。旧 `docs/project/DEPLOYMENT.md` 属于历史快照；其中 `sql.init=always`、手工 ALTER 和初始 Key 输出描述不代表当前源码。

## 本轮验证记录

当前独立 checkout 的 109 个 Java 源文件编译及 standalone JAR 首次打包通过。完成 `build:mobile` 后已再次打包并确认可执行 JAR 内含手机 `index.html`、manifest、Service Worker 与 H2。最终交付文件校验值在发布清单中记录；不把中间包的校验值用于后续重新构建的文件。

最终同源 JAR 为 `src/backend/target/timetable-backend-1.0.0.jar`，34,867,145 字节，SHA-256：

```text
1F10CA7B65E21C4E64142267740E72167036D8833A3A7C9F2D72664AEB45DE32
```

已逐文件核对 JAR 中 25 个静态文件与最终手机 `dist` 的 SHA-256、大小和文件数量，全部一致，无旧静态残留。完整记录见 [BUILD_VALIDATION.json](BUILD_VALIDATION.json)。受限进程中标准重打包的 rename 操作失败，本轮通过忽略目录下的临时 classifier 打包配置生成可执行包；产品 `pom.xml` 未修改，`-DskipTests` 打包结果与下面的测试结果分开记录。

现有 Java 测试执行 53 项，52 项通过；桌面备份文件库测试 1 项在当前 Windows 受限进程中报 H2 只读。独立探针确认该进程的 `Files.isWritable` 返回 false，但直接文件写入成功，H2 再次打开文件库会据此转为只读。内存 H2 用于本轮接口验证；不能把这轮结果写成完整 Maven verify 通过或文件持久化验收通过。正常用户 Java 进程的文件库备份/重启写入仍需另验。

真实 HTTP API 冒烟已于 2026-10-12 执行，29 项检查通过：设备注册/重连、课表/课程/待办/考试读写、待办完成、考试待办三种联动以及跨账号隔离。报告位于根目录 `work/mobile-api-smoke.json`，不提交随机测试身份或测试数据库。运行器还确认完整 JAR 能提供手机 SPA 深链、manifest 与 Service Worker。浏览器行为、AI 模型请求、手机安装和正式 HTTPS 部署仍与这份 HTTP 报告分别验收。

本轮浏览器 CUA 连接超时，受限进程中的 Edge headless 因 named pipe 权限崩溃；没有通过手机浏览器交互或真机安装验收。不能将前端构建、静态资源一致和 API 通过表述为手机端已经完成最终验收。

官方依据：[Spring Boot 外部配置](https://docs.spring.io/spring-boot/docs/3.2.5/reference/html/features.html#features.external-config)、[Nginx proxy_buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)、[Service Worker 安全上下文](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)。
