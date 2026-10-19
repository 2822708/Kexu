# 运维手册 · 给他人开通访问权限

> 适用场景：把系统访问权、或服务器操作权交给朋友/同学/协作者。
> 对应两个脚本：`scripts/ops/grant-server-access.sh`（服务器操作权）、
> `scripts/ops/share-workspace.sh`（数据共用）。

---

## 0. 先分清两件事

这两条权限链路**互相独立**，安全影响差一个数量级，不要混着做：

| | 服务器操作权 | 数据访问权 |
|---|---|---|
| 拿到什么 | SSH 登录服务器、看日志、重启服务（可升级到 root） | 一个 API Key，能读写课表/任务/对话 |
| 风险 | 高（root 档位能看到 `.env` 里全部密钥、能删库） | 中（能删改你们共用的数据，但碰不到服务器） |
| 脚本 | `grant-server-access.sh` | `share-workspace.sh` |

**先想清楚他到底需要什么。** 绝大多数「帮我看看为啥挂了」只需要 `read` 档位。

---

## 1. 服务器操作权

### 1.1 在服务器上执行

```bash
cd /opt/timetable            # 或你实际部署目录
sudo APP_DIR=/opt/timetable ./scripts/ops/grant-server-access.sh \
     --user friend \
     --ssh-key-file /tmp/friend.pub \
     --level read
```

朋友端生成密钥（他自己执行，把 `.pub` 内容发给你）：

```bash
ssh-keygen -t ed25519 -C "friend@laptop"
cat ~/.ssh/id_ed25519.pub
```

### 1.2 三档权限

| `--level` | 能做什么 | 不能做什么 | 额外参数 |
|---|---|---|---|
| `read`（默认） | `systemctl status`、`journalctl -u timetable-backend` | 重启、改文件、看 `.env` | — |
| `restart` | 上面 + 重启/停止/启动**这一个**服务 | 操作其他服务、改配置、读 `.env` | — |
| `root` | 全部 | — | 必须加 `--i-understand-the-risk` |

`restart` 档位的 sudoers 是**白名单到具体命令**的，不是放行整个 systemctl ——
放行 `systemctl` 等于放行 `systemctl edit`（可执行任意命令），那和 root 没区别。

### 1.3 验证与撤销

```bash
# 朋友登录后验证（组权限变更要重新登录才生效）
sudo systemctl status timetable-backend
journalctl -u timetable-backend -n 50

# 撤销
sudo ./scripts/ops/grant-server-access.sh --user friend --revoke
```

撤销脚本会：摘掉所有附加组、删除 sudoers 白名单、清空 authorized_keys、锁定账号密码登录。
账号本身**不删**（避免破坏文件归属），需要彻底删用 `userdel -r friend`。

### 1.4 顺手该做的加固

```bash
# 确认 .env 只有所有者可读（里面有数据库密码和 AI Key）
sudo chmod 600 /opt/timetable/.env

# SSH 加固：改完先确认自己的密钥能登录，别把自己锁在外面
sudo vi /etc/ssh/sshd_config
#   PasswordAuthentication no
#   PermitRootLogin no
sudo sshd -t && sudo systemctl reload sshd
```

---

## 2. 数据访问权（共用同一份）

### 2.1 先了解默认行为（重要）

这套系统**没有注册概念**。设备首次连接时会自动注册一个全新工作区 —— 也就是说，
朋友直接打开你的站点，看到的是**空课表**，不是你的数据。

所以要共用数据，必须显式把 Key 给他。

### 2.2 查现状

```bash
sudo ./scripts/ops/share-workspace.sh --list
```

输出每个 Key 的 label、角色和名下数据量。数据量最大的那个通常就是你自己的。

### 2.3 两种共用方式

**方式 A：直接共用你的 Key（简单，推荐自用场景）**

```bash
sudo ./scripts/ops/share-workspace.sh --source <你的Key>     # 先看数据量对不对
```

然后把你这个 Key 原样给朋友，让他在「设置 → 设备连接」里粘贴。

- 优点：零配置，两人实时看到同一份数据
- 缺点：他用的是**你本人身份**，无法单独撤销他（撤销等于撤销你自己）

**方式 B：单独发一个 Key（可独立撤销）**

```bash
sudo ./scripts/ops/share-workspace.sh --source <你的Key> --label "朋友小明"
```

- 优点：日后 `DELETE FROM api_key WHERE api_key='<新Key>'` 就能单独踢掉他
- 缺点：**这是一个独立空工作区**，看不到你的数据。当前 schema 里没有「工作区成员」这个概念，
  所以做不到「两个 Key 共享同一份数据」
- 脚本会明确打印这层限制，不会含糊过去

> 想让方式 B 也共享数据，需要给 schema 加 `workspace` + `workspace_member` 两层表，
> 把 `api_key` 作为成员指向 workspace。这是结构性改造，涉及全部 mapper 的查询条件，
> 不属于运维范畴，要做需单独立项。

### 2.4 安全前提

- **必须走 HTTPS**。API Key 放在请求头里，明文 HTTP 等于把 Key 广播出去
- 确认有跳转：`curl -I http://你的域名` 应返回 301/308 到 https

---

## 3. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 朋友登录后看不到课表 | 首次连接自动建了空工作区 | 让他改成粘贴你的 Key（§2.3） |
| 给他 Key 后报 401 | Key 有空格/换行 | 重新复制，注意首尾空白 |
| sudo 提示 command not allowed | `restart` 档位白名单只放行特定路径 | `which systemctl` 确认路径，改脚本里的 systemd 路径 |
| 组权限加了但没生效 | 已登录会话不刷新组 | 重新登录，或 `newgrp systemd-journal` |
| 撤销后还能登录 | authorized_keys 缓存或还有别的密钥 | 检查 `/home/<user>/.ssh/authorized_keys` |

---

## 4. 已知历史遗留

`db/migration/mysql/V2__roles_action_workspace_and_recurring_cursor.sql:5` 有一句：

```sql
UPDATE api_key SET account_role = 'ADMIN' WHERE label = 'Tangent0712';
```

这是一次性回填（把当时的存量账号提为管理员），只在新库迁移时执行一次，不是后门。
但**硬编码了账号标签**，属于技术债：换库或改标签会失效。已有 `StandaloneAdminRoleUpgrade`
和 `app.admin-api-keys` 作为正式的管理员授予通道，这句可择机清理。

---

## 5. 从这里部署一份在线实例

### 5.1 为什么不用沙箱的分享链接

开发用的沙箱环境**只作开发**。它的对外网关不保证会把这个应用的端口暴露出去
（实测：进程健康、`/api/health` 返回 up，但分享链接始终 404），
所以对外可用的实例要落在你自己的机器上。

### 5.2 打包

```bash
cd src/backend
mvn -Pstandalone package      # 必须带 -Pstandalone
```

`-Pstandalone` 不能省：H2 驱动只在该 profile 是 runtime scope，前端 dist 也只在该 profile
才会被复制进 jar。漏了的结果是「jar 能跑但打开是空白页 / 启动即找不到驱动」。

产物：`src/backend/target/timetable-backend-1.0.0.jar`（约 35 MB，已含前端）。

### 5.3 部署

```bash
mkdir -p ~/timetable && cd ~/timetable
cp -r <仓库>/scripts/deploy/* .          # Dockerfile + deploy.sh
cp <仓库>/src/backend/target/timetable-backend-1.0.0.jar .

./deploy.sh docker                       # 有 Docker（推荐）
./deploy.sh jar                          # 没 Docker，需要 JDK 17+
PORT=8080 ./deploy.sh docker             # 换端口
PORT=8080 ./deploy.sh stop               # 停
```

两种模式都会：

- 首次运行生成主密钥写入 `.env`（**别删**，换个值已存的 AI Key 就解不开）；
- 数据落在 `./data/`——H2 文件库 + `settings.properties`，重启不丢；
- 等到 `/api/health` 返回 up 才报成功，不会「看起来启动了其实没起」。

### 5.4 装到手机上

浏览器打开实例地址 → 菜单里选「添加到主屏幕 / 安装应用」。

> **必须走 https（或 localhost）**，PWA 的 Service Worker 只在安全上下文注册。
> 局域网 `http://192.168.x.x:3000` 能打开页面，但**装不上、离线缓存也不生效**。
> 要给别人用，前面套一层 Nginx + Let's Encrypt，或用 Cloudflare Tunnel。

### 5.5 备份

```bash
# 停服务后直接复制整个数据目录即可（H2 是单文件库）
./deploy.sh stop && tar czf backup-$(date +%F).tgz data/
```

### 5.6 排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 打开是空白页 | 打包漏了 `-Pstandalone` | 重新 `mvn -Pstandalone package` |
| 启动报 `No suitable driver` | 同上，H2 没进 jar | 同上 |
| 页面能开但一直「暂时无法连接」 | 后端没起 / 端口不通 | `curl <地址>/api/health` 看是不是 503 |
| `/api/health` 返回 503 | 数据库连不上 | 看日志，确认 `./data` 目录可写 |
| 之前配的 AI Key 全部失效 | `.env` 里主密钥变了 | 找回旧值；找不回只能在界面里重填 |
| 装不到主屏 | 走的是 http 而非 https | §5.4 |
