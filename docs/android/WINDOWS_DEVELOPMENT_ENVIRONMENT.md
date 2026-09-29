# Windows Android 开发与界面设计环境

更新：2026-09-27。

本机已完成目录与项目配置，尚未安装缺失的二进制工具。当前执行环境对 Google/Gradle 下载站的 HTTPS 连接失败，因此本轮没有下载 Android Studio/SDK、接受 SDK 许可、启动模拟器或生成 APK。`ConfigureOnly` 的成功只表示本地配置写入成功；独立检查报告目前仍为 `ready: false`。

## 一次安装，日常使用几个入口

先在 Windows 文件管理器中进入 `E:\codex work\projects\Tangent-Timetable\src\android`，双击 **Setup-Android.cmd**。脚本会要求你查看并自行接受 Google 的下载条款，再由官方 SDK Manager 显示尚需确认的 SDK 许可。安装过程需要普通 Windows 终端能够访问 Google、Gradle、Maven Central 和 Gradle Plugin Portal。

安装流程会下载并校验固定版本的软件包，展开 Android Studio、SDK 命令行工具和 Gradle，安装 API 36 平台/源码、Build Tools 35.0.0、adb、模拟器及系统镜像，建立 `Tangent_API_36` 虚拟设备，生成官方 Gradle Wrapper，最后执行单元测试与 Debug APK 构建。任何命令失败都会停止；成功消息不会替代实际构建结果。

| 入口 | 用途 |
|---|---|
| [Setup-Android.cmd](../../src/android/Setup-Android.cmd) | 完整安装、许可交互、生成 Wrapper、首次构建 |
| [Open-AndroidStudio.cmd](../../src/android/Open-AndroidStudio.cmd) | 使用隔离配置打开 Android 工程 |
| [Open-AndroidTerminal.cmd](../../src/android/Open-AndroidTerminal.cmd) | 打开已载入 Java/SDK/Gradle 环境的 PowerShell |
| [Build-Android.cmd](../../src/android/Build-Android.cmd) | 运行 `testDebugUnitTest` 和 `assembleDebug` |
| [Start-AndroidEmulator.cmd](../../src/android/Start-AndroidEmulator.cmd) | 检查硬件加速并启动 `Tangent_API_36` |

首轮下载和依赖解析通常需要数 GB 空间及可用网络；本次检查 E 盘约有 549 GiB 可用。安装包缓存可复用。已存在但校验不符的 ZIP 会停止安装，并明确指出文件；脚本不会悄悄使用损坏缓存。

## 固定工具链与本机路径

| 项目 | 配置 |
|---|---|
| Android Studio | Quail 4 / 2026.1.4 Patch 1，官方 Windows ZIP，IDE 使用自带 JBR |
| Gradle 运行 JDK | 复用 Microsoft JDK 21.0.7：`C:\Program Files\Microsoft\jdk-21.0.7.6-hotspot` |
| Android 字节码目标 | Java 17，保持项目现有设置 |
| Gradle / AGP | Gradle 8.13 / AGP 8.13.2 |
| SDK | Android API 36、Build Tools 35.0.0、platform-tools、sources;android-36 |
| 模拟器 | `system-images;android-36;google_apis;x86_64`，AVD 名 `Tangent_API_36` |
| 工具根目录 | `E:\codex work\tools\android` |
| 项目根目录 | `E:\codex work\projects\Tangent-Timetable\src\android` |

软件包 URL 与 SHA-256 保存在 [toolchain.json](../../scripts/android/toolchain.json)。Studio 与命令行工具来源为 [Android 官方下载页](https://developer.android.com/studio?authuser=31)，Gradle 包及 Wrapper JAR 校验值来自 [Gradle 官方列表](https://gradle.org/release-checksums/)。Java/Gradle/SDK 的组合依据 [AGP 8.13 兼容表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)及 [Gradle Java 兼容表](https://docs.gradle.org/current/userguide/compatibility.html)。

```text
E:\codex work\tools\android\
├── sdk\                     # Android SDK / adb / emulator
├── gradle\gradle-8.13\       # 用于生成官方 Wrapper
├── studio\android-studio\   # Android Studio + 内置 JBR
├── downloads\               # 经 SHA-256 校验的安装 ZIP
├── gradle-user-home\        # 本项目 Gradle 缓存及 JDK 配置
├── android-user-home\      # SDK/模拟器用户状态
├── avd\                    # Android 虚拟设备
├── studio-state\           # IDE 配置、插件、缓存、日志
├── studio.properties       # 指定 IDE 数据目录
├── environment.ps1         # 当前本机环境入口
└── environment-report.json # 最近一次组件检查结果
```

项目 `local.properties` 已指向上述 SDK；本机 Gradle 设置和 `.gradle/config.properties` 已指向现有 JDK 21。这些机器路径和缓存不进入项目 Git。启动入口只给其启动的进程加载变量，系统全局 PATH 不需要改动。

## Compose 界面设计与运行

安装后使用 `Open-AndroidStudio.cmd` 打开项目，等待 Gradle Sync 成功。在 Settings → Build, Execution, Deployment → Build Tools → Gradle 中确认 Gradle JDK 为 `GRADLE_LOCAL_JAVA_HOME` 或本机 JDK 21；在 SDK Manager 中确认路径是本工具目录下的 `sdk`。

当前 UI 位于 `app/src/main/java/com/tangent/timetable/feature`，主题在 `ui/theme/TangentTheme.kt`。Compose 的 Split/Design 预览需要先成功同步依赖，并为目标 Composable 提供 `@Preview` 和示例参数。现有页面包含 ViewModel/Room 数据流，不能把“Studio 已安装”当成这些页面的预览已经通过。

使用 `Start-AndroidEmulator.cmd` 启动设备，或连接已开启 USB 调试并在手机上确认授权的真机，然后在 Studio 选择 `app` 并 Run。设备测试命令为：

```powershell
# 在 Open-AndroidTerminal.cmd 打开的终端中
adb devices -l
.\gradlew.bat :app:connectedDebugAndroidTest
```

Debug APK 成功生成后位于 `app\build\outputs\apk\debug\app-debug.apk`。Room KSP 生成的 schema JSON 位于 `app\schemas`；必须在实际构建后检查并纳入 Git。Wrapper 三个缺失文件也由官方 Gradle 生成，不能手写一个 JAR 来假装安装成功。

## 按需要使用脚本参数

```powershell
# 仅完成本地路径、环境、IDE配置和检查；不联网、不安装
.\Setup-Android.cmd -ConfigureOnly

# 使用真机开发时跳过模拟器和系统镜像下载
.\Setup-Android.cmd -SkipEmulator

# 只安装工具，暂时跳过首次应用构建
.\Setup-Android.cmd -SkipBuild

# 独立检查，不下载、不写配置
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ..\..\scripts\android\Test-AndroidEnvironment.ps1
```

脚本也接受 `-ToolRoot`、`-ProjectRoot` 和 `-JavaHome`。如果改用其他目录或 JDK，后续启动脚本也应传入相同参数，或先点载配置好的 `environment.ps1`。脚本输出中的 “required checks passed” 只证明必要文件和版本配置存在；编译、模拟器启动与设备测试仍有各自独立结果。

如果模拟器提示硬件加速不可用，按 [Android 官方加速指南](https://developer.android.com/studio/run/emulator-acceleration)检查 BIOS 虚拟化和 Windows Hypervisor Platform。该步骤可能需要管理员操作和重启，本安装脚本不会静默修改 Windows 功能。若网络下载失败，可在有网络的普通终端重跑安装入口；不要关闭 TLS 校验，也不要把代理密码写入项目配置。

## 本轮验证记录

- 当前主机 JDK 21.0.7 已识别，E 盘空间足够容纳完整工具链。
- 已实际执行 `Setup-AndroidEnvironment.ps1 -ConfigureOnly`，生成本机 SDK/JDK/IDE 路径配置和缺项报告。
- 脚本使用 Windows PowerShell 5.1 解析与运行验证；修正了在参数默认值中使用 `$PSScriptRoot` 导致路径为空的问题。
- 官方下载地址连通测试失败，错误为 curl 连接失败；当前没有下载、安装或构建成功的证据。
- 安装成功后的版本命令、Gradle 构建与模拟器验证仍待在具备网络访问的本机终端执行。
