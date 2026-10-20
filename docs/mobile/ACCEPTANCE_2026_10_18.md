> 历史验收记录：产品名称已统一为 Kexu。以下运行包、哈希和测试结果属于改名前对应构建；当前命名更新不表示这些验证已再次执行。当前包请查阅发行目录的新清单。

# 本地主数据版验收记录

日期：2026-10-18。范围：`feature/local-first-snapshots`，React移动PWA、IndexedDB业务服务、独立Node密文快照、可选AI直连。原生Android保持暂停，原Java桌面实现未迁至云端。

## 自动检查

| 项目 | 实际结果 | 证据命令 |
|---|---|---|
| 本地核心/事务/联动/编辑器scope | 25/25通过 | `node --test scripts/test-local-core.mjs` |
| 快照加密、队列、恢复、迁移与竞争 | 16/16通过 | `node --test scripts/test-snapshots.mjs` |
| AI协议/安全/确认/异常 | 32/32通过 | `node --test scripts/test-local-ai.mjs` |
| PWA缓存与更新 | 15/15通过 | `node --test scripts/test-pwa.mjs` |
| 教学周日期、旧设备适配 | 7/7、8/8通过 | `test-day-agenda.mjs`、`test-device-session.mjs` |
| 云快照服务 | 10/10通过 | `src/cloud: npm test` |
| 部署边界/打包拒绝/本机HTTP与重启 | 7/7通过 | `node --test deployment/local-first/test-config.mjs` |
| TypeScript / ESLint | 通过 / 0错误、7条既有警告 | `npm run typecheck`、`npm run lint` |
| 移动生产构建 | 通过 | `npm run build:mobile` |
| 普通桌面构建 | 通过，无manifest/SW | `npm run build -- --outDir work/final-desktop` |

合计120项自动回归通过，0失败。前端103、云服务10、部署7分别统计；AI协议4项是32项的子集，不重复计数。使用fake-indexeddb与真实本机HTTP测试，不能等同物理设备断电或浏览器内核兼容性验证。

## 真实浏览器操作

使用隔离的localhost业务数据与测试云空间，未读取或修改真实桌面数据库。通过Codex内置浏览器执行公开UI操作：

- 新建学期、课程、待办，重新加载后仍存在；成功导出核心JSON。
- 创建私人测试空间、另存恢复凭证并确认、开启自动备份，显示当前修订已备份；列表出现3.9KB加密对象。
- 下载并预览快照，确认对话明确告知清空旧AI聊天；点击保存恢复点并替换，修订递增，出现本机恢复点及成功提示。
- 更新提示先确认已保存，执行本机恢复点后刷新；业务数据保留。
- 390×844手机布局默认按日，课程卡可编辑、底部导航可操作；待办页body宽度390，无横向溢出。
- **停止整个静态/快照测试服务**后，重载应用、打开此前未访问的专注页面、完成待办，并新增“服务器关闭时创建：离线写入验收”；再次重载仍能看到新增记录。这证明核心读写无需等待服务器。
- 本地mock OpenAI兼容端点以真实HTTP/SSE返回三个合成提案，UI出现待确认卡；逐一确认课程、待办、考试，均显示已执行；考试关联待办出现在待办列表。360×800的AI页body宽度360。
- CUSTOM选择“脚本文本”，无测试/运行按钮，保存后显示仅保存文本、不执行、不生成待办。

浏览器发现并修复：浮动安装按钮覆盖手机AI发送按钮；聊天页隐藏浮动安装/更新入口和重复快速导入入口，其他页面仍可安装更新。复验点击发送成功。

[离线手机截图](https://github.com/2822708/Kexu/blob/c6c26a13ec812833cf74c374c4c9f5867d8169e6/docs/mobile/evidence/offline-mobile-2026-10-18.jpg)、[AI逐项确认截图](https://github.com/2822708/Kexu/blob/c6c26a13ec812833cf74c374c4c9f5867d8169e6/docs/mobile/evidence/ai-confirmation-mobile-2026-10-18.jpg)。合成Key、测试恢复凭证与云数据均未纳入发行或Git。

## 关键修复

- 本地原子业务事务与跨标签页串行写入；考试/待办、级联与循环补算联动。
- 恢复使用预览修订CAS、保存前恢复点、单事务替换；恢复后数字ID不复用，旧编辑器不能写中另一记录。
- 新增课程/考试/导入窗口绑定课表数字ID及稳定UUID，切换/恢复自动关闭；异步导入过期结果丢弃。
- 快照队列持久化确切密文与ID，失败同体重试；跨标签租约、空间切换和修订水位保护。
- 云对象归属、大小写UUID、幂等、磁盘原子顺序、并发/配额和限流保护；私有存储不位于Web根。
- 全部公共构建资源预缓存，准备完整才报告可离线，API/AI/凭据从不进入SW公共缓存。
- AI完整响应才生提案、严格白名单、目标基准/过期/重复确认保护；导入被代码限制为新增事项，不能借材料提出修改/删除。
- 本机运行入口补齐PDF模块worker的JavaScript MIME，生产模板也显式映射mjs，避免nosniff阻止导入。

## 尚未通过的外部验收

| 项目 | 当前状态 |
|---|---|
| 生产服务器部署 | **未部署**：Windows OpenSSH、Paramiko与裸TCP均在SSH banner/身份认证前收到EOF。HTTP无响应、HTTPS连接被关闭；未执行任何远端安装命令。不能归因于私钥错误，也不能声称服务已上线。 |
| 可信HTTPS / DNS / Nginx / systemd | 模板与运行手册已交付，静态合同通过；尚未在目标Linux执行 `nginx -t`、`systemd-analyze verify`、签发证书或公开健康检查。 |
| 真实模型质量 | 无专用可用端点/模型/Key。12个语义用例标为not_run，mock只证明协议与UI流程。 |
| 物理安卓 / iOS Safari | 尚未验收安装、系统软键盘、后台恢复、文件选择与CORS差异。浏览器尺寸测试不是物理手机测试。 |
| 真断电 / 配额驱逐 / 大数据性能 | 未实测。主库目前是单个版本化工作区记录，规模增长需按性能计划评估；用户清网站数据仍可丢失本机内容。 |
| 旧桌面H2逻辑迁移 | 尚未实现。不能导入物理H2备份，也没有静默把桌面资料传至云端。 |

## 发布包状态

已生成 `2026.10.18-local-first-preview.1`，源码提交 `266fa5aebc5de51774246164d00dfc3ccedf8c00`，打包时工作区干净。43个发行文件加manifest/校验清单，共45个ZIP条目，CRC与逐文件字节比对通过。实际运行包同进程启动后9个HTTP路由和26个Web资源SHA256逐一通过，包含mjs MIME。

[运行包](https://github.com/2822708/Kexu/blob/c6c26a13ec812833cf74c374c4c9f5867d8169e6/releases/mobile/local-first-2026.10.18/README.md)，ZIP SHA256：`52849d33cd0d8d8f0c01e9d4549843dd5f84b835c5286ba774ab40f2dd6f9925`。本轮最终包另开浏览器访问17827及跨进程健康检查超时；同进程运行包HTTP验收通过，前述5180源码构建的浏览器操作证据仍有效。未将这次超时写成最终包浏览器通过。

GitHub已发布至私有仓库 [2822708/Kexu](https://github.com/2822708/Kexu/tree/feature/local-first-snapshots)。首次发布提交 `e220d0b9d47c963238cc87684b4e9fab7f5e9817` 的树为 `1ce93edc4fde15a843f8c574325e487fd7b3e70d`，与本地发布提交 `1fd735a` 的Git树逐字节一致。两张截图和ZIP的远端blob SHA也分别与本地一致，已读回分支及SHA256SUMS核验。

包内 `sourceCommit` 是本地构建提交 `266fa5a`。GitHub通过连接器导入相同文件树，远端提交ID不同；文件树与ZIP散列用于此次交付内容核对。上传后再次跑AI32/32通过，真实12语义项仍not_run，不叠加进120项回归数量。

以上结果不表示生产站点已经部署。

## 重现与后续

从干净checkout进入src/frontend执行npm ci和上表命令；云服务无运行依赖。CI已加入本地回归、桌面/移动构建和云/部署检查，但本机通过不代表GitHub Actions已运行通过。

服务器通路恢复后按deployment/local-first/README.md执行隔离部署，不修改朋友原有站点。先完成Linux配置检查/可信HTTPS，再在目标手机执行离线、备份、恢复和更新验收。AI下一步见 [优化计划](../ai/OPTIMIZATION_PLAN.md)。
