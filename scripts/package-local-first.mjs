import { mkdir, readFile, writeFile, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  sha256,
  validVersion,
  rejectPrivateFile,
  walkRegularFiles,
  verifyReleasePackage,
} from "../deployment/local-first/verify-package.mjs";

const DEFAULT_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
export async function createLocalFirstPackage({
  version,
  output,
  projectRoot = DEFAULT_ROOT,
  sourceCommit,
  sourceDirty,
} = {}) {
  if (!validVersion(version))
    throw new Error(
      "Version must be 1-64 safe letters, digits, dots, underscores or hyphens",
    );
  const root = path.resolve(projectRoot);
  const destination = path.resolve(
    output ?? path.join(root, "releases", "local-first", version),
  );
  if (
    ![path.join(root, "releases"), path.join(root, "work")].some((parent) =>
      inside(parent, destination),
    )
  )
    throw new Error(
      "Package output must be a new directory under this project work/ or releases/",
    );
  try {
    await lstat(destination);
    throw new Error(
      "Output already exists; use a new directory, existing artifacts are never overwritten",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const webRoot = path.join(root, "src", "frontend", "dist");
  const webFiles = await walkRegularFiles(webRoot);
  const webNames = new Set(webFiles.map((file) => file.relative));
  for (const name of [
    "index.html",
    "manifest.webmanifest",
    "sw.js",
    "pwa/icon-192.png",
    "pwa/icon-512.png",
  ])
    if (!webNames.has(name))
      throw new Error(
        `Mobile build is missing ${name}; run npm run build:mobile first`,
      );
  const webManifest = JSON.parse(
    await readFile(path.join(webRoot, "manifest.webmanifest"), "utf8"),
  );
  if (webManifest.scope !== "/" || webManifest.start_url !== "/")
    throw new Error(
      "This dedicated-domain package requires a root-scope PWA build",
    );
  const markers = new Map(
    [
      "tangent-timetable-local-v1",
      "tangent-private-backup-v1",
      "tangent-encrypted-snapshot",
    ].map((marker) => [marker, false]),
  );
  for (const file of webFiles) {
    if (!file.relative.endsWith(".js")) continue;
    const bytes = await readFile(file.absolute);
    for (const marker of markers.keys())
      if (bytes.includes(Buffer.from(marker))) markers.set(marker, true);
  }
  if ([...markers.values()].some((found) => !found))
    throw new Error(
      "dist does not contain the local-first database/backup implementation; rebuild the current source",
    );
  const inputs = webFiles.map((file) => ({
    ...file,
    relative: `web/${file.relative}`,
  }));
  // Explicit runtime allowlist: never walk cloud private data, test output or node_modules.
  for (const file of [
    "server.mjs",
    "package.json",
    "README.md",
    "SECURITY_REVIEW.md",
    "deployment.env.example",
    "test/server.test.mjs",
  ])
    inputs.push({
      relative: `cloud/${file}`,
      absolute: path.join(root, "src", "cloud", file),
    });
  const deploymentFiles = await walkRegularFiles(
    path.join(root, "deployment", "local-first"),
  );
  for (const required of [
    "README.md",
    "preview.mjs",
    "verify-package.mjs",
    "healthcheck.mjs",
    "tangent-snapshots.service",
    "cloud.env.example",
    "nginx-http.conf",
    "nginx-https.conf.template",
  ])
    if (!deploymentFiles.some((file) => file.relative === required))
      throw new Error(`Missing deployment file: ${required}`);
  for (const file of deploymentFiles)
    if (!file.relative.startsWith("test-"))
      inputs.push({ ...file, relative: `deployment/${file.relative}` });
  const prepared = [];
  for (const file of inputs) {
    if (file.relative.endsWith(".map")) continue;
    const info = await lstat(file.absolute);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`Release inputs must be regular files: ${file.relative}`);
    const bytes = await readFile(file.absolute);
    rejectPrivateFile(file.relative, bytes);
    prepared.push({ ...file, bytes });
  }
  const readme = Buffer.from(
    `# 课序 · 本地主数据版 ${version}\n\n本包包含 PWA、私有密文快照服务与独立站点部署模板。课表、课程、考试、待办等主数据只在当前设备 IndexedDB 保存；云端没有业务 CRUD 或 AI 代理。\n\n## 在这台电脑运行\n\n安装/使用现有 Node.js 20+，在解压目录执行：\n\n\`\`\`sh\nnode deployment/preview.mjs --data-dir "E:/codex work/Tangent-local-data"\n\`\`\`\n\n打开 http://127.0.0.1:17827 。无需 Java、Android SDK 或 npm install。只监听本机，手机无法通过电脑 IP 访问。若省略 --data-dir，密文快照放包目录 data/（已在 .gitignore 排除）；此目录不是公开资源，不要重新打包上传。建议将数据目录放包外 E 盘。退出按 Ctrl+C。\n\n请固定使用 127.0.0.1 地址；localhost 和不同端口属于不同浏览器数据空间。本机 loopback 可测试离线/PWA，手机正式使用必须部署可信 HTTPS，不能用普通局域网 HTTP 替代。\n\n## 部署与校验\n\n先阅读 deployment/README.md。目标独立站点：https://timetable.zozovip.work 。HTTP bootstrap 只服务证书验证，拿到真实证书后再开启应用。\n\n原始包校验：node deployment/verify-package.mjs .\nLinux 文件哈希：sha256sum -c SHA256SUMS\n\n核心快照不含 AI 历史、附件、偏好或任何密钥。恢复需用户确认并先保存本机恢复点；AI 需用户单独连接推理服务。发布包校验不等于生产 HTTPS、手机安装与真机验收已经完成。\n`,
  );
  prepared.push({ relative: "README.md", bytes: readme });
  prepared.push({
    relative: ".gitignore",
    bytes: Buffer.from("data/\n*.log\n"),
  });
  if (sourceCommit === undefined) {
    try {
      sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      sourceCommit = null;
    }
  }
  if (sourceDirty === undefined) {
    try {
      sourceDirty =
        execFileSync(
          "git",
          ["status", "--porcelain", "--untracked-files=normal"],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim().length > 0;
    } catch {
      sourceDirty = null;
    }
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  await writeFile(
    path.join(destination, ".packaging-incomplete"),
    "Do not deploy an incomplete release.\n",
  );
  const entries = [];
  for (const file of prepared.sort((a, b) =>
    a.relative.localeCompare(b.relative),
  )) {
    const target = path.join(destination, ...file.relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: "wx" });
    entries.push({
      path: file.relative,
      size: file.bytes.length,
      sha256: sha256(file.bytes),
    });
  }
  const manifest = {
    format: "tangent-local-first-release",
    formatVersion: 1,
    version,
    createdAt: new Date().toISOString(),
    origin: "https://timetable.zozovip.work",
    dataOwnership: "device-indexeddb",
    localSchemaVersions: [1],
    snapshotVersions: [1],
    snapshotScope: "core-without-ai-history-v1",
    sourceCommit,
    sourceDirty,
    files: entries,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(destination, "release-manifest.json"),
    manifestBytes,
  );
  const sums = [
    ...entries.map((file) => `${file.sha256}  ${file.path}`),
    `${sha256(manifestBytes)}  release-manifest.json`,
  ].sort();
  await writeFile(path.join(destination, "SHA256SUMS"), `${sums.join("\n")}\n`);
  await unlink(path.join(destination, ".packaging-incomplete"));
  const result = await verifyReleasePackage(destination);
  return { directory: destination, ...result, sourceCommit, sourceDirty };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--verify")
    console.log(JSON.stringify(await verifyReleasePackage(args[1]), null, 2));
  else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--version", "--output"].includes(args[i]) || !args[i + 1])
        throw new Error(
          "Usage: node scripts/package-local-first.mjs --version VERSION [--output work/NEW_DIRECTORY] | --verify PACKAGE_DIRECTORY",
        );
      options[args[i].slice(2)] = args[i + 1];
    }
    console.log(
      JSON.stringify(await createLocalFirstPackage(options), null, 2),
    );
  }
}
