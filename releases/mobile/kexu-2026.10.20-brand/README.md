# Kexu PWA — 2026.10.20

当前品牌版使用 Kexu 名称，核心数据在设备 IndexedDB 保存；云只提供加密快照与版本文件。日任务、完成撤销、今日回顾、课程与考试使用同一套本地业务逻辑。

- [下载 PWA 运行包](Kexu-2026.10.20-preview.4.zip)
- [发行清单](RELEASE_MANIFEST.json) · [SHA256](SHA256SUMS.txt)
- [本轮验证记录](../../../docs/branding/VALIDATION_2026_10_20.md) · [APK / Windows EXE](../../native/kexu-2026.10.20-native.2/README.md)

## Kexu Local Run

完整解压到 E 盘普通目录，使用已有 Node.js 20+，在解压目录执行：

```powershell
node deployment/preview.mjs --data-dir "E:/codex work/Kexu-local-data"
```

打开 `http://127.0.0.1:17827`。本机普通目录 `app/` 与 ZIP 内运行目录一致，包含 `web/`、`cloud/`、`shared/` 和 `deployment/`；保留完整目录，无需 Java 或 npm install。私有快照目录由 `--data-dir` 指定，不随包发布。退出按 Ctrl+C。

请固定使用相同地址和端口；不同 origin 或浏览器拥有各自的本机数据。原有数据通过保留同一 origin 延续，跨设备或不同外壳需导出核心 JSON，再在目标端预览并确认恢复。新文件采用 Kexu 格式，同时兼容既有恢复凭证和快照。

## Kexu Validation

前端 173 项、云服务与部署 18 项回归全部通过；TypeScript 和三种前端构建通过，ESLint 0 错误。运行包包含完整公共离线资源和独立云兼容注册表；首次离线使用前请确认应用内离线资源已准备完成。

本机入口只监听 loopback，手机不能通过电脑 IP 使用它。正式手机 PWA 需要可信 HTTPS；本轮未验证生产部署、手机安装或真实 AI 服务。AI 需要用户配置兼容服务，业务提案仍须逐项确认。自动备份需要另存恢复凭证并明确开启，恢复仍需手动确认。

发行包校验：`node deployment/verify-package.mjs .`。完整部署步骤见包内 `deployment/README.md`。不要将本机数据目录、恢复凭证或 AI 密钥重新打包上传。
