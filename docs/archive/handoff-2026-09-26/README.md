> 名称整理说明（2026-10-19）：本页为历史资料的 Kexu 阅读副本，名称与示例已统一，原始字节和原始补丁保存在 [Git 历史](https://github.com/2822708/Kexu/tree/c6c26a13ec812833cf74c374c4c9f5867d8169e6)。下文测试、路径及运行包均描述当时版本，不代表当前发行包或本轮重新验证。

# Kexu 交付包

本文件夹是本次工作的全部交付物:**可双击运行的 Windows 免安装桌面版**、代码审查报告、全对话记录、
修复补丁,以及**原版**与**修复版**两个可对比的仓库。

| 项 | 值 |
|---|---|
| 目标仓库 | <https://github.com/2822708/Kexu> |
| 审查的提交 | `57313b1`（`main`） |
| 修复提交 | `32de25c`（分支 `fix/critical-high`） |
| 桌面化提交 | `fb93164` + `8f4f686`（分支 `feat/windows-desktop`） |
| 日期 | 2026-09-26 |
| 说明 | 所有提交均为**本地提交，未 push** |

---

## 目录结构

```
Kexu-交付\
├── README.md                    本文件
├── 01-全对话记录.md              本次会话全过程：审查结论、实测证据、修复与桌面化
├── 02-代码审查报告.md            完整审查报告（2 严重 / 6 高危 / 29 中危 / 低危 / 文档偏差）
├── 03-修复补丁.patch             仅「修复严重与高危」的补丁
├── 04-桌面版补丁.patch           在 03 之上再打「Windows 桌面应用」的补丁
├── 桌面版\                        ★ 可直接双击运行的免安装桌面应用
│   └── Kexu\
├── Kexu-桌面版.zip   上面那个目录的压缩包（62.9 MB）
├── original\                     原版仓库（未修改）  main @ 57313b1
└── fixed\                        修复+桌面化后的源码仓库
```

---

## ★ 桌面版（免安装，零外部依赖）

**双击 `桌面版\Kexu\Kexu.exe` 即可。**
不需要安装 Java、Node.js 或 MySQL —— 数据库、运行时、前端、后端全部在目录里。

| 组成 | 体积 | 说明 |
|---|---|---|
| `runtime\` | 49.2 MB | jlink 裁剪出的 JRE（18 个模块，已实测够用） |
| `app\kexu-backend.jar` | 31.4 MB | Spring Boot fat jar，内含编译好的前端与 H2 驱动 |
| `Kexu.exe` | 26 KB | WebView2 外壳（.NET Framework 4.8 + 系统自带 csc 编译） |
| WebView2 组件 3 个 | 880 KB | 托管程序集 + 原生 Loader |
| **合计** | **81.5 MB** | 整个目录拷到任何 Windows 10/11 x64 机器即可运行 |

### 工作方式

```
Kexu.exe
 ├─ 生成/读取本机账号 Key（desktop-key.txt），注入 WebView 的 localStorage → 免登录
 ├─ 启动 runtime\bin\javaw.exe -jar app\kexu-backend.jar --spring.profiles.active=standalone
 ├─ 轮询 http://127.0.0.1:17817/ 直到就绪（最长 90 秒）
 ├─ 用 WebView2 打开界面（无地址栏、自带图标）
 └─ 关窗时结束后端进程；并用 Job Object 保证外壳异常退出时子进程一并被系统回收
```

### 数据位置

全部在 `%LOCALAPPDATA%\Kexu\`：

| 文件 | 内容 |
|---|---|
| `timetable.mv.db` | H2 数据库（课表、课程、待办、考试、循环规则、AI 对话） |
| `desktop-key.txt` | 本机账号 Key（外壳管理，用于免登录） |
| `settings.properties` | 界面里配置的 DeepSeek Key 等本机设置 |
| `logs\timetable.log` | 后端日志 |
| `webview2\` | WebView2 的用户数据（含登录态） |

> 卸载 = 删掉程序目录 + 删掉上面这个数据目录。

### 首次运行

会自动创建本机账号并**自动登录**，同时弹一次提示把 API Key 显示出来（并复制到剪贴板）——
这是为了让你能在其它设备（iPad 小组件、手机浏览器）上使用同一个账号。之后不再弹出。

### 重新构建

```powershell
cd fixed
powershell -ExecutionPolicy Bypass -File desktop\build-desktop.ps1
```

一条命令完成：前端构建 → 打包含前端的 fat jar → jlink 裁剪 JRE → 下载 WebView2 SDK →
编译外壳 → 组装目录 → 冒烟测试（启动、等就绪、关窗、确认子进程退出）。

### 已知限制

1. **未做代码签名**：首次运行 Windows SmartScreen 会拦一下，需要点"更多信息 → 仍要运行"。
   要消除必须买代码签名证书，这是分发层面的问题，不是技术问题。
2. **依赖 WebView2 Runtime**：Win11 与打过补丁的 Win10 都自带；极老或精简系统需要单独安装
   （外壳在缺失时会给出明确提示）。本机实测版本 153.0.4234.48。
3. **只出 x64**：外壳按 `/platform:x64` 编译，用了 win-x64 的 WebView2Loader。
4. **端口固定 17817**：被占用时会启动失败并提示日志路径。换端口可设环境变量 `KEXU_PORT`。
5. **高 DPI**：已声明 PerMonitorV2，200% 缩放下渲染清晰（见下方"顺带修掉的问题"）。

---

## 两版源码对比

`fixed\` 仓库里 **`main` 仍然是原版**，两个分支分别是两个阶段的成果：

```powershell
cd '...\fixed'
git diff main..fix/critical-high        # 阶段一：修复全部严重与高危（22 文件，+650/−190）
git diff main..feat/windows-desktop     # 阶段二：桌面化（含阶段一）
git checkout main                        # 切回原版代码
git checkout feat/windows-desktop        # 切回最新成果
git branch -D fix/critical-high feat/windows-desktop   # 后悔了：删分支即完全还原
```

关键差异：

| 检查点 | `original\` | `fixed\`（feat/windows-desktop） |
|---|---|---|
| `db/data.sql` 是否内置 `demo-key-001` | 是 | 否（空库时随机生成，或由外壳管理本机 Key） |
| `ApiKeyBootstrap` / `DeepSeekKeyStore` | 无 | 有 |
| 沙箱 `initSafeStandardObjects(null, ?)` | `true` | `false`（不密封才能覆写原型方法，堵住正则入口） |
| 小组件接口 | `/api/widget/overview/{key}`（Key 在 URL） | `/api/widget/overview` + `X-API-Key` 头 |
| 后端单测 | 15 | 21（新增 6 个沙箱回归用例） |
| 桌面版 | 无 | `desktop\`（外壳 + 构建脚本 + DPI 清单） |

> `original\` 的 `git status` 会显示 `backend/mvnw.cmd` 已修改 —— 这是**上游仓库自身**的毛病：
> 该文件的 Git 对象里存的是 CRLF，而 `.gitattributes` 同时声明了 `* text=auto eol=lf` 与
> `*.cmd text eol=crlf`，Windows 上任何克隆都会这样。内容无实质差异，与本次修改无关。

---

## 补丁的应用顺序

```bash
git clone https://github.com/2822708/Kexu my-copy
cd my-copy
git am /path/to/03-修复补丁.patch        # → 修复全部严重与高危
git am /path/to/04-桌面版补丁.patch      # → 再加上 Windows 桌面应用
```

---

## 开发模式运行（改代码时用）

```powershell
# 1) 数据库（XAMPP 自带 MariaDB；也可用控制面板启动）
D:\mapp\mysql\bin\mysqld.exe --defaults-file=D:\mapp\mysql\bin\my.ini --standalone

# 2) 后端 —— 关键：XAMPP 的 root 是空密码，而应用默认读 ${KEXU_COMMON_PASSWORD:root}
$env:KEXU_COMMON_PASSWORD = ''
cd fixed\backend; .\mvnw.cmd spring-boot:run

# 3) 前端
cd fixed\frontend; npm run dev            # http://localhost:5173（必须用 localhost）
```

桌面版与开发模式**互不影响**：前者用 H2 + 17817 端口，后者用 MySQL + 8080 端口。

---

## 本次修了什么（摘要）

**2 个严重 + 6 个高危**：

| 编号 | 问题 | 修复 |
|---|---|---|
| A1 | Rhino 沙箱"超时"停不掉脚本（正则回溯在原生代码里，指令计数器不被调用）→ 每次请求泄漏一个占满 CPU 的线程 | 源码层拒绝正则字面量 + 顶替 `RegExp`/`eval`/`Function` 及相关原型方法 + 并发许可给失控线程数设硬上限 |
| A2 | 可用凭据提交进仓库、每次启动重建 | 移除内置 Key；空库时随机生成；桌面版由外壳管理并免登录 |
| B1 | 提案指纹在调用模型**之后**才计算 | 改为调用前用同一份已加载数据计算 |
| B2 | 小组件凭据走 URL 路径、绕过拦截器 | 改走 `X-API-Key`，恢复拦截器覆盖 |
| B3 | 客户端断连后流仍占线程并落库 | 取消通道贯穿到 DeepSeek 客户端，断连即中断且不落库 |
| B4 | 流式线程池实际只有 4 并发，注释还写错 | `core = max = 可配置`（默认 16） |
| B5 | 调度器无锁/无占位 → 重复待办 | 每期原子占位 + 唯一键兜底 |
| B6 | 调度器整行写回过期实体 → 覆盖用户修改、复活已停用规则 | 全部改为只更新目标列 |

**验证**：后端单测 15 → **21 全绿**；前端 typecheck / lint(0 error) / build 通过；
真实环境回归通过（沙箱 **2013ms+泄漏线程 → 141ms 被拒**、`jstack` 脚本线程 **1 → 0**、
启动竞态下重复待办 **0**、用户修改未被覆盖）；桌面版**启动→就绪→关窗清理**冒烟通过。

**顺带修掉的既有问题**：
- 未匹配路径被兜底成 **500**（现为 404）——`NoResourceFoundException` 被笼统异常处理器吞掉。
- 高 DPI 屏幕上**界面发虚**——进程原本没有 DPI 感知声明（`GetProcessDpiAwareness` = 0 UNAWARE），
  200% 缩放下 Windows 会把整个窗口位图放大。现为 PER_MONITOR_AWARE，实测窗口
  **2360×1640 物理 = 1180×820 逻辑 @200%**。

完整清单见 `02-代码审查报告.md`；桌面化技术细节与实测数据见 `01-全对话记录.md`。
