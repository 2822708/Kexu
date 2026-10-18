# 大切课程表 · Windows 桌面版（WebView2 壳）

把 Web 应用封装为**双击即用的 Windows 桌面程序**。组成：

| 部分 | 说明 |
|---|---|
| `shell/Program.cs` + `DesktopSecurity.cs` | .NET Framework 4.8 + WebView2 外壳（577 + 157 行，C# 5 语法兼容系统自带 csc） |
| `shell/app.manifest` / `app.ico` / `TangentTimetable.exe.config` | DPI 感知清单、图标、运行时配置 |
| `build-desktop.ps1` | 一键构建流水线（锁版本、校验、冒烟、清单） |
| `test-desktop-smoke.ps1` | 隔离冒烟：真跑壳，验证后端所有权、自动登录、进程回收 |
| `verify-package.ps1` | 发布前核对包完整性 |
| `toolchain.json` | **精确版本锁**：Java / Node / npm / csc / WebView2 SDK（含 SHA256） |

壳做的事：启动内置后端（jlink 裁过的 JRE + Spring Boot fat jar，standalone profile）→ WebView2 打开 `http://127.0.0.1:17817/` → 关窗时结束后端，Job Object 兜底回收。首次运行自动生成本机账号并登录，无需手输 Key。

## 前置条件（版本不匹配会被脚本拒绝）

| 项 | 精确版本 | 说明 |
|---|---|---|
| JDK | **Microsoft OpenJDK 21.0.7** | 必须是 Microsoft 发行版（vendor 校验），且带 `jlink`，即完整 JDK 而非 JRE |
| Node.js | **22.23.2** | |
| npm | **10.9.8** | 随 Node 发行，别单独升 |
| .NET Framework | **4.8+**（Release ≥ 528040） | Windows 10/11 自带；csc 用系统 `Microsoft.NET\Framework64\v4.0.30319\csc.exe` |
| WebView2 Runtime | Evergreen（开发包）或 Fixed 153.0.4234.48（发布包） | 大多数 Win10/11 已自带 Evergreen |

## 开发包（推荐先跑这个）

```powershell
cd <仓库>\src\desktop
.\build-desktop.ps1 -AllowEvergreenRuntime
```

用系统已装的 WebView2 Evergreen Runtime，产出**未经发布级验证**的开发包。产物在：

```
src\desktop\app-image\TangentTimetable\
├── TangentTimetable.exe      # 双击启动
├── runtime\bin\javaw.exe     # jlink 裁剪的 JRE（约 40MB，用户机器无需装 Java）
├── app\timetable-backend.jar # 后端（前端产物已内嵌，jar 自己就是完整 Web 服务）
├── Microsoft.Web.WebView2.*.dll + WebView2Loader.dll
├── tools\                    # 备份恢复 / 包校验工具
└── release-manifest.json     # 全量文件清单 + SHA256
```

整个目录可随意拷贝到别的机器（同一份数据不走），双击 `TangentTimetable.exe` 即用。

## 发布包

```powershell
.\build-desktop.ps1 -FixedWebView2RuntimeDir <Fixed Runtime 解压目录>
```

Fixed Runtime 目录里要有 `msedgewebview2.exe`，且版本必须精确等于 `toolchain.json` 里的 `153.0.4234.48`、带有效 Microsoft 签名。发布包不依赖用户机器装 WebView2，`release-manifest.json` 里 `releaseVerified: true`。

常用开关：

| 开关 | 作用 |
|---|---|
| `-SkipSmokeTest` | 跳过冒烟（仅调试用；manifest 会标 `skipped-unverified`） |
| `-OutputDir <目录>` | 改产物位置；已存在的同名目录会被保留并报错，不覆盖 |
| `-SdkPackage <nupkg>` | 用本地 WebView2 SDK 包（SHA256 仍校验） |

## 数据落在哪

- **Windows**：`%LOCALAPPDATA%\TangentTimetable\`
  - `timetable.mv.db` —— H2 数据库
  - `settings.properties` —— DeepSeek Key 等本地设置（加密）
  - `desktop-key.dpapi` —— 本机账号 Key（DPAPI 保护）
  - `logs\timetable.log` —— 运行日志，启动失败先看这里
  - `webview2\` —— 浏览器缓存
- 卸载/删程序目录**不会**删这里；重装不丢数据
- 冒烟测试用独立 `work\desktop-smoke\` 目录，绝不碰真实数据

## 已知边界

- 仅 Windows x64（WebView2 / DPAPI / Job Object 都是 Windows 专有能力，无跨平台计划）
- 端口固定 **17817**，被占用会直接报错提示，不会顺延（冒烟与所有权校验都依赖固定端口）
- 壳启动时若 17817 上已有别的服务在听，属「拒绝复用未知本机服务」，请先关掉它

## 2026-10-18 增量：桌面包第一次真正有界面

此前这条流水线打出的 jar **不含前端产物**——`build-desktop.ps1` 构建了前端 dist，但从没把它同步进后端 `static/`，壳打开 17817 只会得到空白页。本次已修复：

- 新增 `scripts/sync-frontend-dist.mjs`（dist → `src/backend/src/main/resources/static/`）
- 新增 `SpaErrorViewResolver`：`/info`、`/todos` 等前端路由 404 时兜底转发 `index.html`（`/api` 与 非 GET 不兜底）
- `build-desktop.ps1` 在 `npm run build` 之后、`mvnw verify` 之前插入了同步步骤
- 已验证：standalone jar 起服务后 `/`、`/info`、`/assets/*.js` 均 200，`/api/*` 鉴权链路原样
