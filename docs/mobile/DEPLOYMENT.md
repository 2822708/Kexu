# 本地 PWA 与快照服务部署

当前入口为 [deployment/local-first/README.md](../../deployment/local-first/README.md)，包括独立站点、systemd、保守配额、首次HTTPS引导、原子切换与回滚。

本版生产职责：Nginx提供静态页面与发行文件，`/api/v1/`原样代理到本机9001的Node快照进程。业务课表不放云端，Java旧CRUD、认证和AI代理不对手机站点开放。PRIVATE快照目录必须位于Web根之外且由单进程独占。

提供的目标是独立 `timetable.zozovip.work` 站点，不修改朋友既有应用的路由、数据库或凭据。HTTP初始模板只允许ACME挑战与503，取得可信证书并通过 `nginx -t` 后启用HTTPS模板。禁止把测试用CORS、HTTP或无配额设置直接用于公网。

前端构建为 `npm run build:mobile`。普通 `npm run build` 保留原Java适配且不注册SW。只发布经过回归的移动构建，旧版hash资源在新包中保留以服务长期未刷新的页面。包清单列出SHA256；HTTPS建立发布来源信任，散列本身不是签名。

2026-10-18实际远端情况见 [验收报告](ACCEPTANCE_2026_10_18.md)：SSH在身份认证前断开，尚未执行远端安装；模板可用不等于线上已部署。

[旧联网Java/H2部署说明](ONLINE_DEPLOYMENT_2026_10_12.md) 仅供历史版本使用。
