# Windows 桌面版

纳入版本：`8f4f686`。它在 Web 修复版 `32de25c` 之后增加两个提交：

- `fb93164`：Windows 免安装桌面版、H2 单机存储、界面配置 AI Key。
- `8f4f686`：高 DPI 窗口与 WebView 显示修复。

## 当前文件位置

| 内容 | 路径 |
|---|---|
| 桌面外壳 | `src/desktop/shell/Program.cs` |
| 图标和 DPI 配置 | `src/desktop/shell/app.ico`、`app.manifest`、`TangentTimetable.exe.config` |
| 打包脚本 | `src/desktop/build-desktop.ps1` |
| 后端单机配置 | `src/backend/src/main/resources/application-standalone.yml` |
| H2 表结构 | `src/backend/src/main/resources/db/schema-h2.sql` |
| Maven standalone 构建配置 | `src/backend/pom.xml` |
| 本轮拷入的可运行目录 | `releases/windows/TangentTimetable` |
| 可执行文件 | `releases/windows/TangentTimetable/TangentTimetable.exe` |
| 成品校验清单 | [windows-2026-09-26.json](../releases/windows-2026-09-26.json) |

## 它如何运行

WinForms 外壳通过 WebView2 展示共享 React 前端，启动随包的裁剪 Java 运行时和后端 JAR。后端启用 standalone profile，前端静态文件包含在 JAR 中，数据使用本机 H2 文件库；默认端口为 17817。

外壳负责单实例、本机账号与自动登录、窗口关闭时结束内置后端，并使用 Windows Job Object 管理子进程。高 DPI 修复包括 manifest、exe.config 和外壳 DPI 处理。

本轮保留已有成品，未重新构建或启动。已有成品来自用户指定目录；源码基线与成品的对应关系依据交付记录，未通过重构建作二进制可复现验证。

## 运行与用户数据

双击 `releases/windows/TangentTimetable/TangentTimetable.exe`。复制给其它机器时需要复制整个 TangentTimetable 目录，不能只复制 EXE。

包中携带 Java 运行时及后端，因此目标机不需要另装 Java、Node 或 MySQL。外壳仍依赖 Windows x64 环境、.NET Framework 和 Microsoft Edge WebView2 Runtime；随包的 SDK DLL 不等于已安装 WebView2 Runtime。

用户数据库、账号文件、日志和 WebView 数据位于 `%LOCALAPPDATA%\TangentTimetable`。本轮没有读取、复制或修改该目录。AI 配置可在设置页保存到本机数据目录，也可以回退使用后端环境配置；本地设置优先。

## 从源码打包

脚本原有路径算法以 desktop 的父目录寻找 backend/frontend。当前三者同在 src 下，相邻关系保持不变；Maven 的 `../frontend/dist` 同样有效。

```powershell
Set-Location -LiteralPath 'E:\codex work\projects\Tangent-Timetable'
powershell -ExecutionPolicy Bypass -File .\src\desktop\build-desktop.ps1
```

默认输出：`src/desktop/app-image/TangentTimetable`，该目录已被 Git 忽略。

需要完整 JDK/jlink、满足前端依赖要求的 Node/npm、Windows .NET Framework csc 编译器。脚本会构建前端、打包 standalone 后端、生成裁剪运行时、准备 WebView2 SDK、编译外壳，最后启动桌面冒烟。它可能下载依赖，并会清理指定输出目录中的 TangentTimetable 子目录，执行前需检查 OutputDir。

脚本沿用来源实现，本轮只做 PowerShell 语法解析和路径核对。脚本声明的 JDK 17+ 与实际 jlink 参数兼容范围尚未重新验证；来源脚本会选择最新稳定 WebView2 SDK，并非完整锁定的可复现构建。

## 文档与版本边界

原项目使用手册和业务规则仍适用；数据库配置与部署方式需区分默认 MySQL 模式和桌面 standalone/H2 模式。原审查清单针对 `32de25c`，未覆盖全部新增桌面代码。

历史桌面构建记录见 [完整交付会话](../archive/handoff-2026-09-26/01-全对话记录.md)，对应补丁见 [桌面补丁](../archive/handoff-2026-09-26/04-桌面版补丁.patch)。补丁已经合入，不能再次应用到当前源码。
