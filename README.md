# Tangent-Timetable 项目空间

大学生课程表、考试、待办与 AI 助手，包含 Web 和 Windows 桌面版。此目录是后续开发使用的独立项目，文档与源码由同一个 Git 仓库管理。

## 当前手机端版本（2026-10-19）

[本地主数据PWA](docs/mobile/README.md) 已实现设备离线读写、自动加密云快照和手动确认恢复；云只存快照与发行文件。应用显示名现为“课序”，采用浅色蓝绿UI，周课表遮挡已修复。源码在 `feature/local-first-snapshots`，[当前运行包](releases/mobile/kexu-2026.10.19/README.md)、[UI落实与截图](docs/design/UI_IMPLEMENTATION_2026_10_19.md)、[本地版验收](docs/mobile/ACCEPTANCE_2026_10_18.md)、[AI评测与优化](docs/ai/EVALUATION_2026-10-18.md)。原生Android保持暂停。以下工作区建立记录保留历史背景。

## 目录

```text
Tangent-Timetable/
├── .git/                           # 独立 Git 对象库，保留上游历史
├── .github/workflows/ci.yml         # 已适配 src 下的新路径
├── AGENTS.md                       # 当前项目的开发约定
├── README.md                       # 项目入口
├── Tangent-Timetable.code-workspace # 编辑器工作区
├── docs/
│   ├── README.md                   # 文档导航
│   ├── DEVELOPMENT.md              # 当前目录的开发和 Git 操作
│   ├── WORKSPACE_SETUP.md          # 来源、迁移范围和验证结果
│   ├── desktop/                   # 桌面版结构、运行与打包说明
│   ├── android/                   # Android 离线单机版实施方案
│   ├── project/                    # 产品、架构、部署、手册等原项目文档
│   ├── reviews/                    # 项目理解与当前问题清单
│   ├── releases/                   # 成品文件校验清单（纳入 Git）
│   └── archive/handoff-2026-09-26/  # 原交付包说明、会话、审查报告、补丁
├── src/
│   ├── android/                    # Android 原生离线单机版 Kotlin/Compose 工程
│   ├── backend/                    # 共享后端，MySQL 与 standalone/H2 两种配置
│   ├── frontend/                   # Web 与桌面版共享 React 前端
│   └── desktop/                    # WinForms/WebView2 外壳和打包脚本
└── releases/windows/TangentTimetable/ # 现成桌面程序（忽略，不提交大文件）
```

## 从哪里开始

- [文档导航](docs/README.md)
- [开发与 Git 使用](docs/DEVELOPMENT.md)
- [项目理解](docs/reviews/PROJECT_UNDERSTANDING.md)
- [当前问题清单](docs/reviews/CURRENT_ISSUES.md)
- [项目建立记录](docs/WORKSPACE_SETUP.md)
- [桌面版说明](docs/desktop/README.md)
- [Android 移动端实施架构方案](docs/android/ANDROID_IMPLEMENTATION_PLAN.md)
- [Android 实施状态](docs/android/ANDROID_IMPLEMENTATION_STATUS.md)
- [Android/桌面交换 JSON v1](docs/android/EXCHANGE_FORMAT_V1.md)

## Git 基线

- 日常主分支：`main`。
- 原版标签：`baseline/upstream-57313b1`。
- 修复版标签：`baseline/fixed-32de25c`。
- 桌面版标签：`baseline/desktop-8f4f686`（包含桌面打包和高 DPI 修复）。
- 工作区建立标签：`workspace/initial-2026-09-26`。

原版和修复版可直接用标签比较，无需在日常目录内保存两套源码。历史提交仍使用原目录名 `backend/`、`frontend/`；工作区建立提交将它们迁入 `src/`。

仓库已上传至私有GitHub `2822708/Timetable`。当前本地版使用独立分支，原交付目录保持原状；生产部署状态见最新验收报告。

## Android 移动端规划

Android 原生工程及首个离线业务切片已建立在 src/android/，包括课表/考试/待办本地功能和 JSON 文件交换。当前没有可验证的 APK；工具链限制及后续待办见 [Android 实施状态](docs/android/ANDROID_IMPLEMENTATION_STATUS.md)。完整产品边界、AI/提醒/小组件架构仍见 [Android 实施架构方案](docs/android/ANDROID_IMPLEMENTATION_PLAN.md)。

## 本轮范围

本轮完成项目归档、目录分离、CI 路径调整、桌面版纳入和 Git 基线建立。`src` 内已有文件与桌面版基线 `8f4f686` 内容一致；已知业务问题列在 reviews 中，尚未在本轮修复。

启动命令请使用 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。`docs/project` 中保留了原项目文档的原始内容和路径示例，阅读时注意文档顶部的迁移说明。
