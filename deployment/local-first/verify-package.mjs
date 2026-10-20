import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const validVersion = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
export function safeRelative(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    value
      .split("/")
      .every(
        (part) =>
          /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..",
      )
  );
}
export function rejectPrivateFile(relative, bytes) {
  const parts = relative.split("/");
  if (
    !safeRelative(relative) ||
    parts.some((part) =>
      [
        "node_modules",
        ".git",
        "private-snapshots",
        "data",
        "work",
        "target",
        ".packaging-incomplete",
      ].includes(part),
    ) ||
    parts.some(
      (part) =>
        part === ".env" ||
        (/\.env(?:\.|$)/.test(part) && !part.endsWith(".example")),
    ) ||
    /\.(?:pem|key|p12|pfx|db|sqlite|sqlite3|log|dump|keystore|jks|mv\.db|trace\.db|jar|war|apk|aab|zip|tar|gz|7z|rar)$/i.test(
      relative,
    )
  )
    throw new Error(`Forbidden private or runtime file: ${relative}`);
  const text = bytes.toString("utf8");
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
    /\bsk-[A-Za-z0-9_-]{24,}\b/.test(text)
  )
    throw new Error(`Possible secret in package input: ${relative}`);
}
export async function walkRegularFiles(
  directory,
  prefix = "",
  ignoreRootDirectories = [],
) {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(
      `Package input must be a regular directory: ${prefix || "."}`,
    );
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const relative = `${prefix}${entry.name}`;
    if (
      !prefix &&
      entry.isDirectory() &&
      ignoreRootDirectories.includes(entry.name)
    )
      continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Symbolic links are not accepted in release input: ${relative}`,
      );
    if (entry.isDirectory())
      result.push(...(await walkRegularFiles(absolute, `${relative}/`)));
    else if (entry.isFile()) result.push({ relative, absolute });
    else throw new Error(`Non-regular package file: ${relative}`);
  }
  return result;
}
export async function verifyReleasePackage(
  directory,
  { allowRuntimeData = false } = {},
) {
  const root = path.resolve(directory);
  if (!(await lstat(root)).isDirectory())
    throw new Error("Package path must be a directory");
  const manifest = JSON.parse(
    await readFile(path.join(root, "release-manifest.json"), "utf8"),
  );
  if (
    manifest.format !== "kexu-local-first-release" ||
    manifest.formatVersion !== 1 ||
    !validVersion(manifest.version) ||
    manifest.origin !== "https://timetable.zozovip.work" ||
    manifest.dataOwnership !== "device-indexeddb" ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.files.length > 10_000
  )
    throw new Error("Invalid release manifest");
  const expected = new Map();
  for (const item of manifest.files) {
    if (
      !safeRelative(item.path) ||
      expected.has(item.path) ||
      ["release-manifest.json", "SHA256SUMS"].includes(item.path) ||
      !/^[0-9a-f]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0
    )
      throw new Error("Unsafe or duplicate release manifest entry");
    expected.set(item.path, item);
  }
  const files = await walkRegularFiles(
    root,
    "",
    allowRuntimeData ? ["data"] : [],
  );
  const allowed = new Set([
    ...expected.keys(),
    "release-manifest.json",
    "SHA256SUMS",
  ]);
  if (
    files.length !== allowed.size ||
    files.some((file) => !allowed.has(file.relative))
  )
    throw new Error("Package contains missing or unlisted files");
  const checksums = [];
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    rejectPrivateFile(file.relative, bytes);
    const actualHash = sha256(bytes);
    const item = expected.get(file.relative);
    if (item && (item.size !== bytes.length || item.sha256 !== actualHash))
      throw new Error(`Package checksum mismatch: ${file.relative}`);
    if (file.relative !== "SHA256SUMS")
      checksums.push(`${actualHash}  ${file.relative}`);
  }
  const actualSums = (await readFile(path.join(root, "SHA256SUMS"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .sort();
  if (JSON.stringify(actualSums) !== JSON.stringify(checksums.sort()))
    throw new Error("SHA256SUMS does not match package contents");
  return {
    version: manifest.version,
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.size, 0),
    manifestSha256: sha256(
      await readFile(path.join(root, "release-manifest.json")),
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2] || process.argv.length !== 3)
    throw new Error(
      "Usage: node deployment/verify-package.mjs PACKAGE_DIRECTORY",
    );
  console.log(
    JSON.stringify(await verifyReleasePackage(process.argv[2]), null, 2),
  );
}
