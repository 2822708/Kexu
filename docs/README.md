# 文档导航

## 当前项目

[Kexu 命名与兼容边界](BRANDING.md) 说明当前英文品牌、稳定本地数据身份和历史资料处理。

| 文件 | 用途 |
|---|---|
| [install/README.md](install/README.md) | Windows / Android 安装页面、GitHub Releases 下载与升级步骤 |
| [design/UI_REDESIGN_PLAN.md](design/UI_REDESIGN_PLAN.md) | Kexu浅色蓝绿UI、命名依据、页面架构与实施顺序 |
| [design/UI_IMPLEMENTATION_2026_10_19.md](design/UI_IMPLEMENTATION_2026_10_19.md) | 新界面落实、实际截图、周表与移动布局复验、preview.2交付 |
| [design/DAILY_TASKS_PRODUCT_PLAN.md](design/DAILY_TASKS_PRODUCT_PLAN.md) | 今日任务、自选重点、完成正反馈、每日回顾、临时事项与数据迁移策划 |
| [design/DAILY_TASKS_IMPLEMENTATION.md](design/DAILY_TASKS_IMPLEMENTATION.md) | 日任务正式实现、schema2迁移、回顾/草稿、运行包与验收边界 |
| [native/README.md](native/README.md) | 最新本地前端封装 APK 与 Windows EXE 的工程、数据迁移、构建和验收边界 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 新目录下的开发命令和 Git 工作流 |
| [WORKSPACE_SETUP.md](WORKSPACE_SETUP.md) | 项目来源、整理范围、基线及验证 |
| [desktop/README.md](desktop/README.md) | 桌面版安全、备份恢复和构建说明 |
| [mobile/LOCAL_DATA_CLOUD_SNAPSHOTS.md](mobile/LOCAL_DATA_CLOUD_SNAPSHOTS.md) | 2026-10-18 最新目标：设备本地主库、自动云快照、手动确认恢复与更新分发；含旧联网包的迁移边界 |
| [mobile/README.md](mobile/README.md) | 当前本地主数据PWA：运行包、离线使用、备份与验证边界 |
| [mobile/DEPLOYMENT.md](mobile/DEPLOYMENT.md) | 当前本地版独立HTTPS静态站、Node密文快照与部署边界 |
| [mobile/ACCEPTANCE_2026_10_18.md](mobile/ACCEPTANCE_2026_10_18.md) | 本地版自动回归、浏览器断服测试与未完成的外部验收 |
| [ai/EVALUATION_2026-10-18.md](ai/EVALUATION_2026-10-18.md) | AI契约、故障调试、真实模型评测边界 |
| [ai/OPTIMIZATION_PLAN.md](ai/OPTIMIZATION_PLAN.md) | 提示词与AI能力后续优化门槛 |
| [android/ANDROID_IMPLEMENTATION_PLAN.md](android/ANDROID_IMPLEMENTATION_PLAN.md) | Android 离线单机版实施架构、数据模型、提醒、AI、导入导出与验收计划 |
| [android/ANDROID_IMPLEMENTATION_STATUS.md](android/ANDROID_IMPLEMENTATION_STATUS.md) | Android 源码已落地部分、未完成范围与构建验证边界 |
| [android/WINDOWS_DEVELOPMENT_ENVIRONMENT.md](android/WINDOWS_DEVELOPMENT_ENVIRONMENT.md) | Windows 安卓环境安装入口、固定版本、SDK/IDE路径和当前验证状态 |
| [android/EXCHANGE_FORMAT_V1.md](android/EXCHANGE_FORMAT_V1.md) | Android/桌面文件交换 JSON v1 结构与导入语义 |
| [历史交付来源](WORKSPACE_SETUP.md) | 初次桌面导入与校验记录；不是当前发行包清单 |
| [reviews/PROJECT_UNDERSTANDING.md](reviews/PROJECT_UNDERSTANDING.md) | 当前项目结构、数据关系、AI 和循环机制 |
| [reviews/CURRENT_ISSUES.md](reviews/CURRENT_ISSUES.md) | 原始问题处理状态和剩余验证边界 |
| [reviews/OPTIMIZATION_PROPOSAL.md](reviews/OPTIMIZATION_PROPOSAL.md) | 工程架构分析、缺陷风险和分阶段优化方案 |
| [reviews/OPTIMIZATION_STATUS.md](reviews/OPTIMIZATION_STATUS.md) | 优化实施结果、测试状态和部署前事项 |
| [reviews/IMPORT_ASSISTANT_PLAN.md](reviews/IMPORT_ASSISTANT_PLAN.md) | 截图、文件、语音导入与 AI 提案流程设计 |

## 原项目资料

这些文档来自修复版 `32de25c`，产品名称和示例已统一为 Kexu，原始字节保存在 Git 历史。原相对路径仍以旧仓库根为起点；当前源码路径应增加 `src/` 前缀。

| 文件 | 用途 |
|---|---|
| [project/README.md](project/README.md) | 原项目介绍与配置说明 |
| [project/PRD.md](project/PRD.md) | 产品需求 |
| [project/ARCHITECTURE.md](project/ARCHITECTURE.md) | 架构概要 |
| [project/AGENT_GUIDE.md](project/AGENT_GUIDE.md) | 原开发指南与详细机制 |
| [project/USER_MANUAL.md](project/USER_MANUAL.md) | 用户使用手册 |
| [project/WEBVIEW_WIDGET.md](project/WEBVIEW_WIDGET.md) | WebView 与小组件 |
| [project/DEPLOYMENT.md](project/DEPLOYMENT.md) | 原部署流程模板 |
| [project/CONTRIBUTING.md](project/CONTRIBUTING.md) | 原贡献说明 |

## 历史交付记录

- [交付说明](archive/handoff-2026-09-26/README.md)
- [前次会话记录](archive/handoff-2026-09-26/01-全对话记录.md)
- [前次审查报告](archive/handoff-2026-09-26/02-代码审查报告.md)
- [修复补丁阅读副本](archive/handoff-2026-09-26/03-修复补丁.patch)
- [桌面版补丁阅读副本](archive/handoff-2026-09-26/04-桌面版补丁.patch)
- [安卓离线版方案（设计资料）](archive/handoff-2026-09-26/05-安卓离线单机版方案.md)

历史审查报告的顶部是修复状态更新，正文主要保留修复前描述；两份补丁的功能均已包含在当前源码基线；名称整理后的副本只供阅读，不要再次应用。归档中的安卓方案是历史设计稿，已由当前项目中的 [Android 实施架构方案](android/ANDROID_IMPLEMENTATION_PLAN.md) 细化取代；Compose首个离线业务切片已有源码且仍暂停，本次APK另见 [原生外壳封装](native/README.md)。当前项目没有复制 original/fixed 两套目录，版本对比使用 Git 标签。
