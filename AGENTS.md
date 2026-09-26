# Tangent-Timetable 当前工作区指南

## 目录与基线

- 项目根目录为本文件所在目录；Git 根也在这里。
- 后端在 `src/backend`，前端在 `src/frontend`，桌面外壳与打包脚本在 `src/desktop`，文档在 `docs`。
- 后续修改在此项目进行，不修改 `E:\deepseek work\Tangent-Timetable-交付`。
- 当前源码基线为桌面版 `8f4f686`，主分支 `main`；原版 `57313b1`、Web 修复版 `32de25c` 和桌面版历史由 baseline 标签保留。
- 先读 `docs/README.md`、`docs/reviews/PROJECT_UNDERSTANDING.md` 与 `docs/reviews/CURRENT_ISSUES.md`。
- 原项目详细指南在 `docs/project/AGENT_GUIDE.md`。其中目录和命令描述属于原布局；当前路径及开发方式以本文件和 `docs/DEVELOPMENT.md` 为准。

## 实现约定

- 保持 Controller → Service → ServiceImpl → Mapper 分层。
- Java 不使用 Lombok，手写构造器、getter/setter 和 Logger。
- 业务异常使用 BusinessException，所有权校验在业务服务完成。
- 课程、考试属于课表；待办、循环规则属于账号；作息为全局数据。
- AI 先产生提案，由用户逐条确认后执行；保留此交互边界。
- 修改考试或循环功能时同时检查待办联动；修改 AI 时检查工作空间、提案状态和并发一致性。
- 不因旧报告的“已修复”字样省略当前实现和运行证据核对。

## 验证

- 后端：在 `src/backend` 执行 `./mvnw -B test`（Windows 用 `mvnw.cmd`）。
- 前端：在 `src/frontend` 执行 `npm run typecheck`、`npm run lint`、`npm run build`。
- CI 的工作目录和缓存依赖路径必须使用 `src/backend` / `src/frontend`。
- 桌面版说明见 `docs/desktop/README.md`；打包脚本会构建、清理输出并启动冒烟，不把运行脚本视为只读检查。
- 桌面版与 Web 版共用前后端；standalone 使用 H2、静态前端资源和本机设置，需要与默认 MySQL 配置分别验证。
- 按变更影响验证，不把历史测试结果写成本轮运行结果。

## 文档与本地文件

- `docs/project` 保存原项目文档快照；新的当前决定和变更说明写在 docs 及 reviews 中。
- `docs/archive` 是历史交付记录，保留原文，引用时注明当时版本，不将其视为当前状态。
- 密钥、真实数据库配置、node_modules、target、dist、日志和数据库导出不提交。
- 中间脚本和临时输出放 `work/`，该目录已忽略。
- `releases/` 保存桌面成品但不提交大文件；`docs/releases/` 保存文件哈希清单。
- 不读取或提交 `%LOCALAPPDATA%\TangentTimetable` 下的真实用户数据库、账号文件和 AI 密钥设置。
- 数据库已有表不会由 CREATE TABLE IF NOT EXISTS 自动升级，涉及结构变更时明确迁移步骤。
- 当前只配置本地 Git；发布或远程推送按用户后续任务处理。
