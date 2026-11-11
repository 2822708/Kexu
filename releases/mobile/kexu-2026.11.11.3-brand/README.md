# Kexu PWA（2026.11.11.3）

- [下载 PWA 运行包](Kexu-PWA-2026.11.11.3.zip)
- [发行清单](RELEASE_MANIFEST.json) · [SHA256](SHA256SUMS.txt)
- [APK / Windows EXE](../../native/kexu-2026.11.11.3/README.md)

包内 51 个文件、ZIP 61 个条目；解压后 3,763,848 字节。启动修复与 `.2` 的课表改动均包含在内。

## 本地运行

```powershell
node deployment/preview.mjs --data-dir "E:/codex work/Kexu-local-data"
```

打开 `http://127.0.0.1:17827`。无需 Java 或 npm install，私有快照目录由 `--data-dir` 指定。

## 验证

`typecheck`、Lint（0 error）、shell/mobile 构建通过；`verify-package.mjs` 校验 51 个文件通过；`web/index.html` 与本机 mobile 构建逐字节一致。尚未验证生产部署、手机安装和真实 AI 服务。
