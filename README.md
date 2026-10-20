# Kexu

大学生课程表、考试、待办、日任务与 AI 助手。核心数据优先保存在设备本地，云端只提供加密快照、应用更新和下载。

仓库：[2822708/Kexu](https://github.com/2822708/Kexu)。项目空间示例：`E:\codex work\projects\Kexu`。使用 [Kexu.code-workspace](Kexu.code-workspace) 打开源码与文档。

## 使用与下载

- [PWA 运行与部署](docs/mobile/README.md)：离线读写，自动加密云备份，恢复前预览并手动确认。
- [Android APK 与 Windows EXE](docs/native/README.md)：界面资源随包携带，核心业务不需要 Java、Node 或网页服务器。
- [日任务实现](docs/design/DAILY_TASKS_IMPLEMENTATION.md)：快速录入临时任务、完成反馈、撤销和手动打开每日回顾。
- [AI 配置与评测](docs/ai/EVALUATION_2026-10-18.md)：可选的自带密钥连接；业务修改逐项确认后执行。

手机网页正式部署需要可信 HTTPS；原生包的 AI 与云快照需要另行配置服务并验证跨域。浏览器、APK、EXE 的数据相互隔离，可通过 JSON 导出、预览与确认导入迁移。设备、真实模型和生产部署的验证范围以对应验收记录为准。

## 源码与文档

```text
Kexu/
├── Kexu.code-workspace       # 编辑器工作区
├── AGENTS.md                # 开发约定
├── docs/                    # 产品、架构、设计、部署和历史记录
├── src/
│   ├── frontend/            # 共用 React 界面与本地业务
│   ├── shared/              # 跨端兼容标识
│   ├── android-shell/       # 当前 Android APK 外壳
│   ├── windows-shell/       # 当前 Windows EXE 外壳
│   ├── backend/             # 兼容 Java REST/SSE 与 H2/MySQL 模式
│   ├── desktop/             # 历史 Java 服务桌面外壳
│   └── android/             # 暂停中的独立 Kotlin/Compose 重写工程
├── scripts/                 # 构建、检查和打包入口
├── deployment/              # 快照服务与部署配置
└── releases/                # 运行包、安装包、校验与发布说明
```

[文档导航](docs/README.md)、[开发命令](docs/DEVELOPMENT.md)、[项目架构](docs/reviews/PROJECT_UNDERSTANDING.md)、[当前问题](docs/reviews/CURRENT_ISSUES.md)。版本对比使用 Git 提交与既有 `baseline/*` 标签；原交付文件和历史提交保留。

## 命名与兼容

当前产品、仓库、工程、构建产物及文档统一使用英文名称 **Kexu**。已安装应用和已有数据的稳定身份由兼容层保留；改名不清空数据库，不更换恢复密钥，也不伪造历史测试结果。原作者许可证与历史用户身份保持原样。

归档文档的名称已经统一，原始字节、原始补丁、旧安装包及其校验记录可在 Git 历史中查阅。完整边界见 [Kexu 命名说明](docs/BRANDING.md)。
