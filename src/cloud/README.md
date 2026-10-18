# 私有密文快照服务

此服务只管理加密快照及最小归属元数据，不提供课表、待办、AI 会话或推理 API。设备 IndexedDB 是主库，断网/授权失败不阻止本地使用。

要求 Node.js 20+。生产使用同一 HTTPS 站点的 Nginx 将 `/api/v1/` 转发到本服务；不开放跨站 CORS，不对公网开放服务端口。源码无外部运行依赖。

```sh
SNAPSHOT_DATA_DIR=/srv/tangent/private-snapshots \
SNAPSHOT_ALLOWED_ORIGIN=https://your-timetable.example.com \
PORT=9001 node server.mjs
```

服务固定监听 `127.0.0.1`，启动前确认端口空闲。`SNAPSHOT_DATA_DIR` 是独立私有目录，目录权限 0700、对象和索引 0600；不得放入 Nginx 静态站目录、公开下载目录或 GitHub。一个进程独占该目录，不能启动多个写入实例。生产进程使用专用非 root 用户和 systemd 常驻。反向代理应限制请求体至 `10m`、设置 30 秒以上代理超时、为注册端点另设按真实访客 IP 的频率限制。服务只信任连接 IP，不信任客户端可伪造的 `X-Forwarded-For`；经 Nginx 转发时内置注册限额是所有访问者共享的每日 3 次，应保留作为全站保险，反向代理再按访客限流。默认最多 200 个空间，每空间 50 份 / 100 MiB，每快照最多 10 MiB，全站 2 GiB；满额返回 507，不自动删除可恢复版本。

共享主机首批试用建议采用 [`deployment.env.example`](./deployment.env.example) 的较小配额：全站 **256 MiB**，每空间 **32 MiB / 20 份**，最多 **16 个空间**，120 次鉴权请求/分钟和全站 3 次注册/天。这些变量只修改配额，不改变设备主库。内置并发上限为 2 个上传、2 个下载、16 个连接，避免合法 token 被滥用来并发缓冲大量 10 MiB 对象。建议 systemd 使用 `MemoryMax=256M`、`TasksMax=32`、`Restart=on-failure`；实际主机内存应先核对。容量告警应同时监控快照目录实际磁盘用量，进程被强杀时可能留下未索引临时对象，不应仅依赖接口报告的逻辑大小。

Nginx 保持 API 原始路径，不删除 `/api/v1` 前缀：

```nginx
location ^~ /api/v1/ {
    client_max_body_size 10m;
    client_body_timeout 20s;
    proxy_pass http://127.0.0.1:9001;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_connect_timeout 5s;
    proxy_read_timeout 35s;
    add_header Cache-Control "no-store" always;
}
location = /api/v1 { return 404; }
location ^~ /api/ { return 404; }
```

`proxy_pass` 地址后不加 `/`，否则 Nginx 会重写路径。公共版本文件放 `/releases/` 的独立只读目录；私有数据目录不配置 `root`/`alias`。`SNAPSHOT_ALLOWED_ORIGIN` 必须为实际 HTTPS 站点的 origin（无页面路径）。云服务没有业务和 AI 代理路由，不应将旧 Java API 配到这个域名下。

## API v1

- `GET /api/v1/health`：状态及协议版本。
- `POST /api/v1/vaults`，JSON `{}`：创建空间，返回 `vaultId`、随机 `token` 和配额；服务器仅保存 token SHA-256。仅此次响应返回 token。
- 以下全部使用 `Authorization: Bearer <vaultId>.<token>`，不接受查询参数中的凭据：
  - `GET /api/v1/snapshots`：当前空间快照元数据，至多 50 项，最新在前；包含已用容量和配额。
  - `POST /api/v1/snapshots`：上传 `tangent-encrypted-snapshot` JSON。首次成功 201；相同 ID 与完全相同字节重试返回 200；相同 ID 不同内容返回 409。返回对象 ID、大小、SHA-256、来源数据集/修订及时间。
  - `GET /api/v1/snapshots/<uuid>/content`：下载该空间的密文 JSON。未知及外部空间对象均返回 404。
  - `DELETE /api/v1/snapshots/<uuid>`：明确删除当前空间对象；不修改设备主库。

对象以规范小写 UUID 命名，不能通过传入路径访问任意文件，也不会因文件系统忽略大小写而覆盖同名对象。上传在单进程串行临界区内检查所有配额并原子替换索引；先写密文、文件 fsync、rename，再写索引并 fsync/rename。Linux 另外对目录 fsync，保证对象先于索引持久化。快照对象一旦建立不可改写；删除是显式操作。启动时校验已索引文件的大小与哈希，损坏则拒绝启动，避免继续声称备份完整。文件系统/进程异常不将请求体、凭据或文件内容写入日志。

## 客户端与恢复

`src/frontend/src/backup` 持久保存授权、AES-256-GCM 密钥、上传任务及退避状态。密钥只留设备并由用户单独导出恢复凭证，云端不持有密钥。用户另存凭证并确认后才可开启自动备份；默认防抖 60 秒、最短上传间隔 5 分钟，启动/前台/联网触发补传，关闭应用不保证准点上传。

AES-GCM 使用随机 96 位 IV 和 128 位标签，格式版本、快照 ID、来源数据集、修订和创建时间都进入附加认证数据。未上传任务不影响本地提交；失败保留完全相同密文与 ID 供幂等重试。上传完成后比对服务器哈希、大小、ID、数据集与修订，按备份 scope 更新单调递增水位；切换空间后的旧回包无效。IndexedDB 租约协调同站标签页。

核心快照覆盖课表、节次、课程、考试、考试待办联动、循环规则/发生记录和专注完成记录；以稳定 UUID 引用。明确不包含 AI 历史、附件、偏好或任何凭据。CUSTOM 脚本以不可执行数据保留，本地恢复不会执行。

恢复固定经过：下载/选文件 → 解密/校验 → 数量预览 → 用户确认 → 保存当前本机恢复点 → 单事务替换。恢复点失败或本地修订在预览后发生变化时中止；设备身份/云凭据保留，AI 聊天被明确清空以阻止旧提案误关联。本机保留最近 10 份恢复点，可再预览恢复；列表仅读取小型元数据，选定时才读取完整负载。恢复凭证应单独保管，不能进入普通数据快照或日志，丢失密钥服务器无法解密。首版没有自助访问令牌轮换；若恢复凭证泄露，应停止使用该空间，由管理员撤销旧空间访问并重新创建空间，不能只在设备上点击断开后认为旧 token 已失效。

## 验证

```sh
node --test test/*.test.mjs
```

测试自行创建 `work/snapshot-service-tests/` 下的临时目录并清理，不读取真实快照或用户数据。前端 `scripts/test-snapshots.mjs` 覆盖加密/篡改、字段排除、UUID 引用、确认恢复及修订竞态、恢复点失败和上传水位。生产 HTTPS、安装与真机体验需另外验收。
