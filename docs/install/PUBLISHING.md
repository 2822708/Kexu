# 发布 Kexu 安装包

下载入口是 [GitHub Releases](https://github.com/2822708/Kexu/releases)，安装页面是本目录的 [README](README.md)。独立 `index.html` 随发行版提供下载，不代表已启用 GitHub Pages。仓库访问权限保持不变。

更新版本时，先构建并验收 APK 和完整 Windows ZIP，保存源码、签名及 SHA256 清单。然后更新 `deployment/release-current.json`、安装页和发行说明中的版本、文件名、大小及链接；Android 升级必须保持应用 ID 和发布签名，并提高版本号。

在项目根目录运行 `python scripts/prepare-github-release.py work/NEW_STAGING_DIRECTORY --tag VERSION_TAG`，核对暂存文件。该命令只复制明确允许的公共文件，检查包大小、散列、压缩包完整性和私有路径；现有目录不会被覆盖。

将修改合入默认分支、检查通过后，创建与配置一致的 Git 标签并推送。`Publish Kexu installers` 工作流会创建草稿、上传附件，下载并逐字节比对、验证 SHA256，成功后才发布。失败时检查 Actions 日志；已有发布附件不会自动覆盖。修订已交付程序时发布新版本。

发行附件包括 APK、Windows ZIP、发行清单、`Kexu-Install.html`、`INSTALL.md` 和覆盖这些文件的 `SHA256SUMS.txt`。私钥、用户 Data、WebView2 用户配置和测试资料不参与发布。
