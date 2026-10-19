# 服务器操作交接单 · 给 Codex

> 交接日期：2026-10-19　｜　交接人：WorkBuddy　｜　执行人：Codex（被授权操作服务器）
>
> **读法**：本文是自包含的。你不需要了解此前的对话。按顺序读，§2–§4 是你要做的事，
> §5 是你**绝对不能碰**的东西，§6 是出问题怎么回滚。

---

## 1. 任务边界（先读这段，避免做多）

本次委托的范围**只有服务器侧操作**：

| 要做 | 不做 |
|---|---|
| 在**用户的服务器**上创建账号、配 SSH 公钥、按档位授权 | ❌ 不改产品代码、不改数据库结构 |
| 生成/管理共享用的 API Key | ❌ 不碰 AI 功能、不动 `.env` 里的密钥值 |
| 部署、重启、看日志、排查线上问题 | ❌ 不做仓库的 `git push`（推送通道在用户手上） |

**改代码不在委托范围内。** 如果发现需要改代码才能解决的问题，写进交付说明，不要自己动手。

---

## 2. 环境事实（已核实，不用重新调研）

### 2.1 部署形态

```
浏览器 ──HTTPS──> Nginx ──静态文件──> <WEB_ROOT>/
                     │
                     └──location /api/ 反向代理──> Spring Boot 127.0.0.1:8080 (systemd)
                                                        │
                                                        └──> MySQL 库 timetable
```

- **前端**：Vite + React + TS + Ant Design，构建产物是纯静态文件
- **后端**：Spring Boot 3.2.5，`src/backend`，产物 `timetable-backend-1.0.0.jar`
- **systemd 服务名**：`timetable-backend`（部署文档示例值，**上机先确认**：`systemctl list-units | grep -i timetable`）
- **应用目录**：文档示例 `/opt/timetable`（**上机先确认**：`systemctl show timetable-backend -p WorkingDirectory`）

> ⚠️ 上面三处加粗的都要**先在服务器上确认实际值**，不要直接套用文档示例。
> 这套系统在用户机器上可能装在别的路径。

### 2.2 数据模型的关键事实（容易踩）

- 这套系统**没有"用户注册"**。身份凭证就是 API Key，放在请求头 `X-API-Key` 里
- 设备首次连接时，前端会自动调 `/api/auth/device` **注册一个全新工作区**。
  所以「新设备连上来 = 空课表」，不会自动看到别人的数据
- 所有业务数据直接挂在 `api_key` 上，**没有 workspace / member 这层**
- `api_key` 表关键列：`api_key`(PK, VARCHAR(64))、`label`、`account_role`
  - 列名是 **`account_role`**，不是 `role`（`role` 是迁移前 V1 的旧列，别用错）
  - `account_role` 在 V2 迁移里加的，`NOT NULL DEFAULT 'USER'`
- 角色只有两级：`ADMIN` / `USER`。**ADMIN 的实际作用只有一个**——
  允许在界面里修改 AI Key（`AiController:149` 的 `canEdit`）。
  除此之外没有管理员专属功能，不要假设它权限更大

### 2.3 配置与密钥位置

| 内容 | 位置 | 说明 |
|---|---|---|
| 数据库密码 | `<APP_DIR>/.env` 的 `TANGENT_COMMON_PASSWORD` | 必须 `chmod 600` |
| AI Key | `<APP_DIR>/.env` 的 `DEEPSEEK_API_KEY`，或界面里填 | **正在等待用户轮换**，别复制到别处 |
| 初始管理员 | `<APP_DIR>/.env` 的 `TANGENT_BOOTSTRAP_KEY` | 仅在空库首次启动时生效 |
| 管理员 Key 白名单 | `ADMIN_API_KEYS`（逗号分隔） | 与 `account_role=ADMIN` 任一命中即算管理员 |

**systemd 的 `EnvironmentFile` 只认 `KEY=value`，不能写 `export`。** 写 `export` 会导致变量解析不到，
服务起不来（历史踩过这个坑）。

---

## 3. 任务一：给指定用户开通服务器操作权

### 3.1 现成脚本，优先用它

仓库里已有脚本，**不要手写一套**：

```bash
cd <APP_DIR>
sudo APP_DIR=<APP_DIR> ./scripts/ops/grant-server-access.sh \
     --user <用户名> \
     --ssh-key-file /tmp/<用户名>.pub \
     --level read
```

三档权限：

| `--level` | 赋予什么 | 用 sudoers 限定到 |
|---|---|---|
| `read`（默认） | `journalctl` 看日志、`systemctl status` | 具体命令白名单 |
| `restart` | 上面 + 重启/停止/启动**这一个**服务 | 具体命令白名单 |
| `root` | 完整 sudo | 无（需 `--i-understand-the-risk`） |

**默认用 `read`。** 不要因为"省事"直接给 `root`——root 能读到 `.env` 里的数据库密码和 AI Key。

### 3.2 脚本做了什么（供你核对，不要跳过）

1. `adduser --disabled-password`（只允许密钥登录，禁密码）
2. 公钥格式校验 + 去重后写入 `~/.ssh/authorized_keys`（600、属主正确）
3. 加入 `systemd-journal` 组（看日志所必需）
4. 写 `/etc/sudoers.d/<用户>-timetable`，**`visudo -cf` 校验失败自动回滚删除**
5. `<APP_DIR>/.env` 自动 `chmod 600`

撤销：

```bash
sudo ./scripts/ops/grant-server-access.sh --user <用户名> --revoke
```

撤销会摘组、删 sudoers、清 authorized_keys、shell 改 `nologin`。**账号不删**（避免破坏文件归属）。

### 3.3 验证（必须做，否则等于没授权）

```bash
# 在服务器上
sudo -l -U <用户名>                    # 应只列出白名单命令
id <用户名>                            # 应含 systemd-journal 组
ls -l <APP_DIR>/.env                   # 应为 -rw------- 
visudo -cf /etc/sudoers.d/<用户>-timetable   # 应为 parsed OK
```

让用户在自己机器上登录一次确认：

```bash
ssh <用户名>@<服务器> 'sudo systemctl status timetable-backend; journalctl -u timetable-backend -n 20'
```

> **组权限要重新登录才生效**。已登录的会话看不到新组，别误判成失败。

---

## 4. 任务二：让指定用户共用同一份数据

### 4.1 先看清现状

```bash
cd <APP_DIR>
sudo ./scripts/ops/share-workspace.sh --list
```

会输出每个 Key 的 label、角色、名下课表/任务数量。**数据量最大的通常就是用户本人的**——
但不要猜，拿不准就问用户确认。

### 4.2 两条路，必须先告知用户区别

| 方式 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 直接给用户的 Key** | 把用户现有的 Key 交给对方 | 零配置、真正看到同一份数据、实时同步 | 对方用的是**用户本人身份**，无法单独撤销（撤他就等于撤用户自己） |
| **B. 新生成一个 Key** | `share-workspace.sh --source <用户Key> --label "对方名称"` | 可单独撤销（`DELETE FROM api_key WHERE api_key='<新Key>'`） | **是独立空工作区，看不到用户的数据** |

**根因**：schema 里没有 `workspace` / `workspace_member` 两层表，所有数据直接挂 `api_key`。
所以「两个 Key 共享同一份数据」**当前架构做不到**。脚本会把这句限制明确打印出来。

> 不要为了「让方式 B 也能共享」去改数据归属（`UPDATE schedule SET api_key=...`）。
> 那是把数据从用户名下**搬走**，用户自己就看不到了。要真正实现需要加表 + 改所有 mapper，
> 属于产品级改造，不在本次委托范围。

**推荐流程**：把这个对比表原样告诉用户，让他选。默认建议方式 A（他自己用、风险自担场景）。

### 4.3 对方接入的步骤

1. 打开站点 → 设置 → 设备连接
2. 粘贴 Key（注意首尾不要有空格）
3. 刷新，应能看到课表

验证 Key 有效：

```bash
curl -H "X-API-Key: <Key>" https://<DOMAIN>/api/auth/verify
# 应返回 {"code":200,...,"data":{"role":"ADMIN"|"USER",...}}
```

**前提：必须走 HTTPS。** Key 在请求头里，明文 HTTP 等于把凭证广播出去。
检查跳转：`curl -I http://<DOMAIN>` 应返回 301/308 到 https。

---

## 5. 红区：不要碰

| 事项 | 原因 |
|---|---|
| `.env` 里的**值** | 含数据库密码与待轮换的 AI Key。只读权限，不要打印到终端或写进交付说明 |
| `UPDATE api_key SET account_role='ADMIN'` 批量提权 | 管理员只是「能改 AI Key」，没有其他收益，提权只会扩大风险面 |
| 前端产物里的 `account_role` 自改 | 权限判定在服务端（`AdminAuthorizationService`），改前端无效且有误导 |
| 数据库结构（`ALTER TABLE`） | 不在委托范围。需要的话写建议 |
| `docs/migration` 里的 Flyway 脚本 | 已执行的迁移不可修改，否则 `validate` 会失败 |
| 给任何人 `root` 档位 | 除非用户**明确书面**要求，且已备份数据库 |
| 浏览器插件 / 爬学校教务系统 / 推荐算法 | 项目登记禁区（见 `docs/HANDOVER.md` §6.7），技术上也不要往这个方向给建议 |

---

## 6. 回滚预案

| 操作 | 回滚方式 |
|---|---|
| 授权 | `grant-server-access.sh --user <用户> --revoke` |
| 彻底删号 | `userdel -r <用户>`（先确认没有文件属主依赖） |
| 新增共享 Key | `DELETE FROM api_key WHERE api_key='<Key>';`（该 Key 名下数据由外键 `ON DELETE CASCADE` 一并删除——**先确认该 Key 下没有数据**） |
| 服务起不来 | `journalctl -u timetable-backend -n 100 --no-pager`，重点看 datasource 与 `EnvironmentFile` |
| 部署了新版本要退回 | 保留上一版 jar，改 systemd `ExecStart` 指回旧 jar，`daemon-reload` + `restart` |

**动数据库之前必须先备份**：

```bash
mysqldump -u<user> -p --single-transaction --routines timetable > /var/backups/timetable-$(date +%F-%H%M).sql
# 验证备份非空且能解析（不要只看文件大小）
grep -c 'CREATE TABLE' /var/backups/timetable-*.sql | tail -1
```

---

## 7. 交付说明模板

完成后把这段填好发给用户：

```
【服务器操作交接 · 回执】
服务器：<IP/域名>
时间：<yyyy-mm-dd hh:mm>

任务一 · 服务器操作权
  用户名：<user>
  权限档位：read / restart / root
  验证结果：sudo -l 输出=<粘贴关键行>；SSH 登录=<成功/失败>
  撤销命令：sudo <APP_DIR>/scripts/ops/grant-server-access.sh --user <user> --revoke

任务二 · 数据共用
  采用方式：A（直接共用用户 Key）/ B（新 Key）
  共享 Key 后四位：<只报后四位，不要全量回执>
  对方验证结果：<能看到课表 / 仍是空课表 + 原因>

风险提示已告知用户：
  [ ] .env 已 chmod 600
  [ ] 站点走 HTTPS 且 http 有跳转
  [ ] 已说明方式 A 无法单独撤销对方

未解决 / 需要用户决策：
  - <逐条列出>
```

---

## 8. 交接前已核实的结论（省你时间）

以下几点我已经查过并验证，你可以直接采信：

1. `api_key` 表的角色列是 **`account_role`**，`NOT NULL DEFAULT 'USER'`。
   因此 `DEPLOYMENT.md` 里那条只写 `(api_key, label, avatar_url)` 的 INSERT **能成功**（走默认值）
2. 两条运维脚本**已在沙箱实跑验证**：
   - 授权脚本：建号 → 入组 → sudoers 440 且 `visudo` 解析 OK → 撤销后组移除、sudoers 删、shell 改 nologin
   - SQL 在 H2(MySQL 模式) 实跑：list 查询、数据量统计、INSERT、读回 `account_role`、DELETE 全部通过
3. `db/migration/mysql/V2__...sql:5` 有一句硬编码 `UPDATE api_key SET account_role='ADMIN' WHERE label='Tangent0712'`。
   它是**一次性回填**（只在新库迁移时执行），不是后门，但属技术债。**不要去改这个已执行的迁移文件**
4. 项目没有 workspace 层，所以「两个 Key 看同一份数据」当前不可能——这点务必如实告知用户，不要承诺

---

## 9. 沟通规则

- 每一步**先说明要做什么、影响什么**，再执行。用户不具备后台上下文
- 涉及删除、提权、改数据，**执行前先要一次明确确认**
- 不确定的地方（服务名、路径、域名）**先查再问**，不要用示例值硬套
- 完成后按 §7 模板回执。**不要**在回执里粘贴任何完整密钥
