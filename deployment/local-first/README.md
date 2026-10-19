# timetable.zozovip.work 独立部署

本目录仅用于新站点 `timetable.zozovip.work`，不替换朋友已有站点、服务、证书、数据库或防火墙。当前说明是交付运行手册，不表示已经连接或部署服务器。实际发布前须完成 SSH、DNS、资源、端口、证书与真机验收。

## 包与本机运行

包目录包含 `web/`、`cloud/`、`deployment/`、`README.md`、`release-manifest.json`、`SHA256SUMS`。仅需 Node.js 20+，云服务无 npm 运行依赖；不需要 Java 或 Android SDK。

```powershell
node deployment/preview.mjs --data-dir "E:/codex work/Tangent-local-data"
```

浏览器打开 `http://127.0.0.1:17827`。入口固定只监听 loopback，自动创建随机 loopback 云端口并同源转发，数据放显式目录；省略参数则放包内 `data/`，不会作为网页提供。`data/` 被包内 `.gitignore` 排除，不能上传或重新打包。首次运行前可执行 `node deployment/verify-package.mjs .`；已有默认 `data/` 后，原始包校验会提示额外文件，请将数据保存在包外。预览入口会跳过自己的私有运行目录校验，并继续检查所有发行文件。

本机 loopback 支持安全上下文测试，手机不能访问此入口。局域网 HTTP 地址不具备手机离线/PWA 安装条件，正式手机入口必须使用可信 HTTPS。固定域名与端口，改变 origin 会产生另一份设备数据库。停止进程不会删除 IndexedDB 或快照目录。

## 服务器目录和权限

| 位置 | 内容与权限 |
| --- | --- |
| `/var/www/timetable/releases/<version>/` | 完整发行目录，root:root；目录0755、普通文件0644 |
| `/var/www/timetable/current` | 指向某个发行目录的相对软链，原子切换 |
| `/var/www/timetable/assets/` | 共享只读哈希资源，保留旧资源供旧标签页读取 |
| `/var/www/timetable/downloads/` | 公开 ZIP、版本元数据和校验清单；不放云端代码或数据 |
| `/var/www/timetable/acme/` | 仅证书 HTTP 验证 |
| `/var/lib/tangent-snapshots/` | 私有密文及 token 哈希，tangent:tangent，0700；文件0600 |
| `/etc/tangent-snapshots/cloud.env` | root:root，0600；配额与站点配置 |

先检查 CPU/内存/磁盘、`node --version`（>=20）、`ss -lnt` 的9001占用及 `nginx -t`。端口已被其他程序使用时停止本次操作，不杀其他服务。检查 `tangent`、上述目录、`tangent-snapshots.service` 和同名 Nginx site 是否已存在；若不是本项目资源，不覆盖。

专用账户首次创建参考：

```sh
sudo useradd --system --home-dir /var/lib/tangent-snapshots --no-create-home --shell /usr/sbin/nologin tangent
sudo install -d -m 0755 /var/www/timetable /var/www/timetable/releases /var/www/timetable/assets /var/www/timetable/downloads /var/www/timetable/acme
sudo install -d -m 0700 -o tangent -g tangent /var/lib/tangent-snapshots
sudo install -d -m 0700 /etc/tangent-snapshots
```

不要递归修改 `/var/www`、`/var/lib`、`/etc/nginx` 的权限。Node 必须在 `/usr/local/bin` 或 `/usr/bin`，专用用户能够执行；不要依赖 root 的 nvm 配置。systemd 将文件系统设为只读，只允许写本项目私有目录和私有临时目录。默认限制256 MiB内存、50% CPU、32任务；根据实际共享主机资源核对后使用。

## 上传与激活发行目录

将本机生成并校验的 ZIP 通过已验证主机身份的 SSH 上传至专用临时目录，先核对可信来源的 ZIP SHA-256，再解压；哈希只验证字节，不能替代发布者身份。不要从未核实的包中直接执行脚本。以下 `PACKAGE` 指向已解压的原始包：

```sh
PACKAGE=/tmp/tangent-release
node "$PACKAGE/deployment/verify-package.mjs" "$PACKAGE"
VERSION="$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).version" "$PACKAGE/release-manifest.json")"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || exit 1
RELEASE="/var/www/timetable/releases/$VERSION"
test ! -e "$RELEASE" || exit 1
sudo mkdir "$RELEASE"
sudo cp -a "$PACKAGE/." "$RELEASE/"
sudo chown -R root:root "$RELEASE"
sudo find "$RELEASE" -type d -exec chmod 0755 {} +
sudo find "$RELEASE" -type f -exec chmod 0644 {} +
node "$RELEASE/deployment/verify-package.mjs" "$RELEASE"
```

再将 `web/assets/` 中的哈希文件复制到 `/var/www/timetable/assets/`：同名已存在时先 `cmp -s` 验证字节相同，不同则中止，不能覆盖旧哈希资源；保留所有仍可能被旧标签页引用的文件。此步骤在切换前完成。

首次配置将 `cloud.env.example` 安装到 `/etc/tangent-snapshots/cloud.env`（0600），将 unit 安装到 `/etc/systemd/system/tangent-snapshots.service`（0644）。已有配置不因更新被覆盖。私有目录不属于发行目录，切换或回滚均不得复制、清空它。

确认 `current` 不存在或为本项目软链，记录 `readlink /var/www/timetable/current` 作为上一个版本，然后原子切换：

```sh
sudo ln -s "releases/$VERSION" /var/www/timetable/.current-next
sudo mv -T /var/www/timetable/.current-next /var/www/timetable/current
sudo systemctl daemon-reload
sudo systemctl enable tangent-snapshots
sudo systemctl restart tangent-snapshots
node "$RELEASE/deployment/healthcheck.mjs" --cloud
```

`.current-next` 已存在时中止并检查，不自动覆盖未知路径。`enable`设置开机启动，`restart`启动或重启本项目服务。后台仅监听 `127.0.0.1:9001`，不开放公网端口。运行 `systemd-analyze verify` 和 `systemctl status tangent-snapshots` 检查实际系统支持与启动状态。

## 先 HTTP 验证，再获取真实 HTTPS

确认域名 A/AAAA 指向本机、80/443可达。新 Nginx site 放 `/etc/nginx/sites-available/timetable.zozovip.work`，只链接同名 `sites-enabled` 项，不修改 `default` 或朋友的配置。

1. 安装 `nginx-http.conf` 到上述新site，执行 `nginx -t` 成功后 reload。它只提供 ACME 和 `/healthz`，其他请求503，不在明文 HTTP 下运行应用。
2. 使用管理员现有的可信 certbot 安装执行：`certbot certonly --webroot -w /var/www/timetable/acme -d timetable.zozovip.work --cert-name timetable.zozovip.work`。域名/防火墙未就绪则保留 bootstrap，不能伪造证书或关闭验证。
3. 检查实际生成的 `fullchain.pem`、`privkey.pem` 属于该域名，再用 `nginx-https.conf.template` 替换**同一个** site 文件。模板引用的是取得证书后的标准路径；包内没有证书或私钥。不要同时启用两份模板。
4. 执行 `nginx -t` 后 reload，只 reload 不重启整个 Nginx。`certbot renew --dry-run` 验证续期，并配置仅在续期成功且 `nginx -t` 通过后 reload 的 deploy hook。
5. 执行 `node "$RELEASE/deployment/healthcheck.mjs" --https`，再进行真机验收。

HTTPS模板兼容Ubuntu22常见的Nginx语法。API保持`/api/v1/`前缀，`proxy_pass`不加尾`/`；其余`/api/`均404，不代理Java或AI。API与SW均`no-store`，哈希资源长期缓存；CSP允许用户主动连接HTTPS AI推理端点，不提供云AI代理。HSTS仅针对该子域名且先设一天，不使用includeSubDomains/preload。私有目录无root/alias映射。

## 发布下载与更新

只把本次 ZIP、外部计算的 ZIP SHA-256、`release-manifest.json` 放入 `downloads/<version>/`。根目录`downloads/stable.json`可按`stable.example.json`填写真实版本、ZIP URL及哈希后原子发布；**不能发布占位符**。ZIP哈希在ZIP生成后计算，不嵌入其自身文件，避免循环校验。公开版本与应用静态资源可缓存，`stable.json`不缓存。

应用SW会下载公共资源并在用户确认、保存本机恢复点后切换。网页代码更新不恢复/覆盖业务数据；恢复快照是另一个明确确认操作。未来本地schema升级后，旧代码未必兼容，不可把服务器静态回滚当作浏览器数据库回滚。

## 日志、健康与回滚

- `journalctl -u tangent-snapshots --since today --no-pager`：服务只输出启动与错误，不输出token、密文或解密密钥。unit有日志速率限制。
- 新site访问日志只记录方法、无query的URI、状态及字节，不记录Authorization/Referer。检查现有Nginx logrotate是否已覆盖`/var/log/nginx/*.log`，不要添加重复轮转规则。
- 检查`df -h`、`du -sh /var/lib/tangent-snapshots`、`systemctl show tangent-snapshots -p MemoryCurrent`；逻辑配额不代替实际磁盘告警。默认全站256 MiB、单空间32 MiB/20份、16空间，注册为全站3次/天。
- 回滚时先校验先前完整发行目录及schema兼容性，将`.current-next`指向记录的旧`releases/<version>`，`mv -T`原子替换current，restart**本项目**服务并重跑健康检查。不要删除当前/旧发行目录、哈希资源、私有快照或本机IndexedDB。
- 服务故障仅影响云快照；本地业务可继续。快照目录异常先停本服务并原样复制备份，不在线删索引或未知对象。找不到旧版本或schema不兼容时停止自动回滚并保留现场。

必须另行验收：可信HTTPS、手机首次离线打开每个核心路由、断网编辑/重开、云失败补传、另一设备凭证恢复、更新前恢复点和浏览器持久化。Node静态合同检查、文件校验或localhost测试不等于这些实际部署验收已经通过。

模板显式补充 mjs 与 webmanifest MIME，参考 [Nginx types 指令](https://nginx.org/en/docs/http/ngx_http_core_module.html#types)；仅允许本站申请麦克风，仍需应用同意与浏览器授权，不会自动授权语音。
