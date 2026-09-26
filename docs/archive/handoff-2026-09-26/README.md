# Tangent-Timetable 交付包

本文件夹是本次会话的全部交付物：代码审查报告、全对话记录、修复补丁，以及**原版**与**修复版**两个可对比的仓库。

| 项 | 值 |
|---|---|
| 目标仓库 | <https://github.com/Tangent0712/Tangent-Timetable> |
| 审查的提交 | `57313b1`（`main`） |
| 修复提交 | `32de25c`（本地分支 `fix/critical-high`，**未 push**） |
| 日期 | 2026-09-26 |

---

## 目录结构

```
Tangent-Timetable-交付\
├── README.md                 本文件
├── 01-全对话记录.md           本次会话 10 轮问答全记录 + 全部实测证据 + 修复矩阵
├── 02-代码审查报告.md         完整审查报告（2 严重 / 6 高危 / 29 中危 / 低危 / 文档偏差）
├── 03-修复补丁.patch          git format-patch 格式，可 git am 到任意原版克隆
├── original\                原版仓库（未修改）  main @ 57313b1
└── fixed\                   修复版仓库         fix/critical-high @ 32de25c
```

---

## 两版对比

`fixed\` 这个仓库里 **`main` 分支仍然是原版**，因此不用切目录就能对比：

```powershell
cd 'E:\deepseek work\Tangent-Timetable-交付\fixed'
git diff main..fix/critical-high      # 查看全部改动（22 文件，+650/−190）
git diff --stat main..fix/critical-high
git checkout main                      # 切回原版代码（工作区会变成修复前）
git checkout fix/critical-high         # 切回修复版
git branch -D fix/critical-high        # 后悔了：删掉分支即完全还原，main 从未被改动
```

两版的关键差异：

| 检查点 | `original\` | `fixed\` |
|---|---|---|
| `db/data.sql` 是否内置 `demo-key-001` | 是 | 否（改为空库时随机生成并只打印一次） |
| 是否有 `config/ApiKeyBootstrap.java` | 无 | 有 |
| 沙箱 `initSafeStandardObjects(null, ?)` | `true`（密封） | `false`（不密封，才能覆写原型方法） |
| 小组件接口 | `/api/widget/overview/{key}`（Key 在 URL 路径） | `/api/widget/overview` + `X-API-Key` 请求头 |
| 后端单测数 | 15 | 21（新增 6 个沙箱回归用例） |

> `original\` 的 `git status` 会显示 `backend/mvnw.cmd` 已修改 —— 这是**上游仓库自身**的毛病：
> 该文件的 Git 对象里存的是 CRLF，而 `.gitattributes` 同时声明了 `* text=auto eol=lf` 与 `*.cmd text eol=crlf`，
> Windows 上任何克隆都会这样。内容无实质差异，与本次修改无关。

---

## 如何运行（本机已具备全部条件）

本机依赖：**JDK 21**、**Node 22**、**XAMPP 自带的 MariaDB 10.4.32**（`D:\mapp\mysql`）。

```powershell
# 1) 启动数据库（也可用 XAMPP Control Panel → MySQL → Start）
D:\mapp\mysql\bin\mysqld.exe --defaults-file=D:\mapp\mysql\bin\my.ini --standalone

# 2) 启动后端
#    关键：XAMPP 的 root 是空密码，而应用默认读 ${TANGENT_COMMON_PASSWORD:root}
#    不设置这个变量会 Access denied
$env:TANGENT_COMMON_PASSWORD = ''
cd 'E:\deepseek work\Tangent-Timetable-交付\fixed\backend'
.\mvnw.cmd spring-boot:run

# 3) 启动前端（另开一个终端）
cd 'E:\deepseek work\Tangent-Timetable-交付\fixed\frontend'
npm install        # 若 node_modules 被清理过
npm run dev        # http://localhost:5173
```

打开 <http://localhost:5173/>，API Key 填 **`demo-key-001`**。

> ⚠️ 必须用 `localhost`，**不要用 `127.0.0.1:5173`** —— Vite 默认只绑定 IPv6 的 `::1`。
>
> `demo-key-001` 之所以还能用，是因为数据库 `timetable` 在修复前就已建好、里面已有这条记录。
> **全新数据库**不会有它：修复版会在 `api_key` 为空时自动创建首个账号，把随机 Key **只打印一次**到日志
> （也可用 `TANGENT_BOOTSTRAP_KEY` 预先指定自己的 Key）。

### 门禁命令

```powershell
cd ...\fixed\backend;  .\mvnw.cmd -B test                      # 21 个测试
cd ...\fixed\frontend; npm run typecheck; npm run lint; npm run build
```

### 停止全部

```powershell
Get-NetTCPConnection -LocalPort 8080,5173 -State Listen -EA SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
& 'D:\mapp\mysql\bin\mysqladmin.exe' -u root --skip-password shutdown
```

---

## 修复了什么（2 严重 + 6 高危）

| 编号 | 问题 | 修复要点 |
|---|---|---|
| **A1** | Rhino 沙箱的"超时"停不掉脚本：正则回溯在原生代码里，指令计数器不会被调用 → 每次请求泄漏一个永久占满 CPU 的线程 | 源码层拒绝正则字面量 + 改用不密封标准对象以顶替 `RegExp`/`eval`/`Function` 及相关原型方法 + 并发许可（被遗弃线程不归还许可）+ `unavailable` 标志不再误停用户规则 |
| **A2** | 可用凭据提交进仓库、每次启动自动重建、还打进前端产物 | 移除内置 Key；新增 `ApiKeyBootstrap` 首启随机生成并只打印一次；删掉前端兜底 |
| **B1** | 提案指纹在**调用模型之后**才计算，基线取错时刻 → 过期提案能通过复查 | 改为在调用模型前、用与 Prompt/`_before` 同一份已加载数据计算 |
| **B2** | 小组件凭据走 URL 路径且绕过认证拦截器 → 进访问日志/历史/Referer | 改走 `X-API-Key`；恢复拦截器覆盖；地址改用 `#key=`（fragment 不进日志） |
| **B3** | 客户端断连无法感知，被遗弃的流仍占线程并落库 | 取消通道贯穿到 DeepSeek 客户端，断连即中断上游且不落库 |
| **B4** | 流式线程池实际只有 4 并发（`core=4`+队列），注释还写错策略 | `core = max = 可配置`（默认 16），注释与实现一致 |
| **B5** | 调度器无锁/无占位/无唯一约束 → 同一次触发重复生成待办 | 每期原子占位（条件更新）+ 唯一键 `uk_todo_recurring_ddl` 兜底 |
| **B6** | 调度器整行写回过期实体 → 覆盖用户修改、复活已停用规则 | 全部改为只更新目标列 |

**验证结果**：后端单测 15 → **21 全绿**；前端 typecheck / lint(0 error) / build 通过；
真实 MariaDB 回归通过（灾难性正则 **2013ms+泄漏线程 → 141ms 被拒**、`jstack` 中脚本线程 **1 → 0**、
启动竞态下重复待办 **0**、用户修改的标题未被覆盖）。

### A1 的诚实边界

进程内**无法 100% 根除**：JVM 不能安全抢占一次正在执行的原生调用。
已做到「消除全部已证实的无界原生入口 + 把失控线程数限制在并发许可（2）以内，用满即失败关闭」，
即把「无界资源耗尽」降级为「有界且可告警」。彻底方案是把求值移入可强杀的独立进程 —— **未做**，
已在代码注释、`AGENTS.md`、`ARCHITECTURE.md` 中写明。

## 未修复（本次范围外）

29 个中危与若干低危/文档偏差。优先建议：C1（未绑定课表的对话使 COURSE 作用域指纹退化为常量）、
C2（提案并发重复执行）、C3/C4（失效逻辑未按工作空间隔离、非法提案落库）。
完整清单与修复顺序见 `02-代码审查报告.md` 顶部「修复状态」一节与正文。

## 数据库侧的一处手工变更

修复 B5 需要给 `todo` 表加唯一键，而 `CREATE TABLE IF NOT EXISTS` 不会给已存在的表补索引，
因此已在现有 `timetable` 库上手动执行：

```sql
ALTER TABLE todo ADD UNIQUE KEY uk_todo_recurring_ddl (recurring_id, ddl);
```

全新数据库由 `schema.sql` 自动带上（`recurring_id` 为 NULL 的手工待办不受影响）。
