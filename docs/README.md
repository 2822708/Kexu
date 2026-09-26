# 文档导航

## 当前项目

| 文件 | 用途 |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | 新目录下的开发命令和 Git 工作流 |
| [WORKSPACE_SETUP.md](WORKSPACE_SETUP.md) | 项目来源、整理范围、基线及验证 |
| [desktop/README.md](desktop/README.md) | 桌面版运行、结构、数据目录与构建说明 |
| [releases/windows-2026-09-26.json](releases/windows-2026-09-26.json) | 纳入的桌面成品逐文件 SHA-256 清单 |
| [reviews/PROJECT_UNDERSTANDING.md](reviews/PROJECT_UNDERSTANDING.md) | 项目结构、数据关系、AI 和循环机制 |
| [reviews/CURRENT_ISSUES.md](reviews/CURRENT_ISSUES.md) | 当前仍需处理的问题和验证边界 |

## 原项目资料

这些文档来自修复版 `32de25c`，保留原文。原相对路径仍以旧仓库根为起点；当前源码路径应增加 `src/` 前缀。

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
- [原修复补丁](archive/handoff-2026-09-26/03-修复补丁.patch)
- [桌面版补丁](archive/handoff-2026-09-26/04-桌面版补丁.patch)
- [安卓离线版方案（设计资料）](archive/handoff-2026-09-26/05-安卓离线单机版方案.md)

历史审查报告的顶部是修复状态更新，正文主要保留修复前描述；两份补丁均已包含在当前源码基线，不要再次应用。安卓方案仅为归档设计文档，不表示已有安卓源码或成品。当前项目没有复制 original/fixed 两套目录，版本对比使用 Git 标签。
