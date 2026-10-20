# 开发与版本管理

## 当前工作目录

项目根目录：`E:\codex work\projects\Kexu`。

这是独立文件夹和独立 Git 仓库，未创建或修改磁盘分区。根目录同时管理 docs 和 src，二者没有嵌套 Git 仓库。Windows 桌面源码也在 `src/desktop`，与前后端共享同一版本线。

## 环境

- 后端构建目标：Java 17，使用项目自带 Maven Wrapper。
- 前端锁定 ESLint 的 Node 要求为 `^20.19.0 || ^22.13.0 || >=24`。原文档中的 Node 18+ 不满足完整检查链。
- 数据库：原项目目标 MySQL 8；历史交付记录另有 MariaDB 实测。本轮没有启动数据库。
- AI 功能需要 `DEEPSEEK_API_KEY`；普通业务可在未配置 AI 时使用。
- 桌面版使用 standalone/H2 文件数据库，AI Key 也可在界面设置。见 [桌面版说明](desktop/README.md)。

本轮未复制真实 `.env` 或 application-local/prod 配置，未安装依赖。项目根的 `.env.example` 和前端 `.env.example` 是模板；Spring 不会仅因为根目录存在 `.env` 就自动读取它，运行时应由环境变量或本地 profile 注入配置。

## 检查命令（PowerShell）

```powershell
Set-Location -LiteralPath 'E:\codex work\projects\Kexu\src\backend'
.\mvnw.cmd -B test

Set-Location -LiteralPath 'E:\codex work\projects\Kexu\src\frontend'
npm ci
npm run typecheck
npm run lint
npm run build
```

## 启动（PowerShell）

先准备数据库和本机环境配置。默认后端配置读取 `KEXU_COMMON_PASSWORD`，AI 读取 `DEEPSEEK_API_KEY`。不要把真实值写到版本控制中的文档或命令示例。

```powershell
# 后端终端：先在当前进程配置所需环境变量
Set-Location -LiteralPath 'E:\codex work\projects\Kexu\src\backend'
.\mvnw.cmd spring-boot:run

# 另一终端启动前端；首次先运行 npm ci
Set-Location -LiteralPath 'E:\codex work\projects\Kexu\src\frontend'
npm run dev
```

默认前端 `http://localhost:5173`，后端 `http://localhost:8080`；Vite 将 `/api` 代理至后端。已有数据库需核对列、索引和账号，不把空库初始化当作版本迁移。

## Git 日常使用

```powershell
Set-Location -LiteralPath 'E:\codex work\projects\Kexu'
git status
git log --oneline --decorate -10

# 查看前次修复相对原版的变更
git diff baseline/upstream-57313b1 baseline/fixed-32de25c

# 查看桌面版相对 Web 修复版的变更
git diff baseline/fixed-32de25c baseline/desktop-8f4f686

# 从已建立的项目上开展一个具体修改，分支名按实际任务选择
git switch -c fix/issue-name

# 审阅后按具体文件暂存，并提交
git diff
git add -- docs/reviews/CURRENT_ISSUES.md
git diff --cached
git commit -m 'docs: update current issue status'
```

当前远程默认分支是 `fix/complete-optimization-plan`。修改前读取 `git remote show origin` 与 `git status` 核实实际分支；历史标签继续指向不可变的交付基线。

远程仓库为 `https://github.com/2822708/Kexu`。推送前检查目标分支、工作区和秘密文件范围；本机与远程历史不能代替用户数据备份。不要强推替换既有历史。

## Git 忽略范围

忽略依赖与构建目录、日志、真实 `.env.*`、application-local/prod 配置、work 临时文件和常见数据库转储/密钥文件。示例 `.env.example` 继续跟踪。

当前安装包与便携程序位于 `releases/native`，PWA 运行包位于 `releases/mobile`；使用各发行目录自己的校验清单。历史 Java 桌面包不因源码改名自动更新。H2 数据文件和本地 settings/account 文件也被忽略。

Windows Maven 包装器在原 Git 对象中存储 CRLF；新仓库对该文件使用 `-text` 保留原字节，避免原 `.gitattributes` 设置引起的永久脏状态。其他文件沿用原规则。
