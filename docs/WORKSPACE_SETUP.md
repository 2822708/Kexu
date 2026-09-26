# 项目空间建立记录

日期：2026-09-26。

## 来源与布局

- 来源交付目录：`E:\deepseek work\Tangent-Timetable-交付`。
- 新项目目录：`E:\codex work\projects\Tangent-Timetable`。
- 文档在 `docs`，业务源码在 `src/backend`、`src/frontend`。
- 根目录使用一个独立 Git 仓库，无嵌套源码仓库。

## 初始导入

以修复版 `32de25c` 克隆，使用 `--no-hardlinks`，不共享原目录 Git 对象文件，也不使用 alternates。

- 保留原 29 个提交，建立 main 分支。
- `baseline/upstream-57313b1` 保留原版。
- `baseline/fixed-32de25c` 保留 Web 修复版。
- 移动源码到 src；移动原产品文档到 docs/project，并增加迁移提示。
- 新增项目入口、开发说明、当前问题清单和编辑器工作区。
- 更新 CI 中的工作目录与缓存依赖路径。
- 原交付材料复制到 docs/archive，保留其历史文字，不重复应用补丁。
- 没有配置远程，也没有推送或部署。

## 初始验证

- 130 个 backend/frontend 跟踪文件逐文件 Git blob 比较，与 `32de25c` 完全一致。
- 初次导入的 4 份交付文件 SHA-256 与导入当时的源文件一致。
- Windows Maven 包装器保留原 CRLF 字节，通过专门 attributes 规则消除换行规范化产生的脏状态。
- 原 `fixed` 工作区在核对时干净。
- 本轮未安装依赖、未执行完整构建测试、未启动服务。

## 后续加入桌面版

用户补充桌面成品位置并确认将桌面源码和文档纳入同一项目。随后发现来源仓库已更新到 `8f4f686`，新增桌面打包及高 DPI 修复两次提交。下一次项目提交将记录这些源码、历史材料及桌面交付物的纳入结果。
