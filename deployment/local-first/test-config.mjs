import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdir, mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalFirstPackage } from "../../scripts/package-local-first.mjs";
import {
  verifyReleasePackage,
  rejectPrivateFile,
  safeRelative,
} from "./verify-package.mjs";
import { startPreview } from "./preview.mjs";
import { checkPublicSite } from "./healthcheck.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(directory, "..", "..");
const read = (name) => readFile(path.join(directory, name), "utf8");
function balancedConfig(value) {
  let level = 0,
    quote = null,
    comment = false,
    escaped = false;
  for (const character of value) {
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") level++;
    if (character === "}") level--;
    assert.ok(level >= 0, "unexpected closing brace");
  }
  assert.equal(quote, null, "unclosed nginx string");
  assert.equal(level, 0, "unclosed nginx block");
}
test("HTTP bootstrap is confined to the new hostname and serves only ACME/health until real HTTPS exists", async () => {
  const source = await read("nginx-http.conf");
  balancedConfig(source);
  assert.deepEqual(
    [...source.matchAll(/server_name\s+([^;]+);/g)].map((m) => m[1]),
    ["timetable.zozovip.work"],
  );
  assert.match(source, /well-known\/acme-challenge/);
  assert.match(source, /return 503/);
  assert.doesNotMatch(
    source,
    /ssl_certificate|proxy_pass|default_server|current\/web/,
  );
});
test("HTTPS template preserves API paths, private boundaries, security headers and error/SW/API no-store", async () => {
  const source = await read("nginx-https.conf.template");
  balancedConfig(source);
  assert.deepEqual(
    [...source.matchAll(/server_name\s+([^;]+);/g)].map((m) => m[1]),
    ["timetable.zozovip.work", "timetable.zozovip.work"],
  );
  assert.equal([...source.matchAll(/proxy_pass\s+([^;]+);/g)].length, 2);
  for (const match of source.matchAll(/proxy_pass\s+([^;]+);/g))
    assert.equal(match[1], "http://127.0.0.1:9001");
  assert.match(source, /location \^~ \/api\/v1\//);
  assert.match(source, /location \^~ \/api\/ \{ return 404;/);
  assert.match(source, /\^\[45\]\[0-9\]\[0-9\]: "no-store"/);
  assert.match(source, /sw\\\.js\$ "no-store"/);
  assert.match(source, /:\/api\/ "no-store"/);
  for (const header of [
    "X-Content-Type-Options",
    "Referrer-Policy",
    "X-Frame-Options",
    "Permissions-Policy",
    "Content-Security-Policy",
    "Strict-Transport-Security",
  ])
    assert.ok(source.includes(header));
  assert.match(source, /connect-src 'self' https:/);
  assert.match(source, /application\/javascript mjs/);
  assert.match(source, /listen 443 ssl http2/);
  assert.doesNotMatch(
    source,
    /http2 on|includeSubDomains|preload|default_server|Access-Control-Allow-Origin|alias\s+\/var\/lib|root\s+\/var\/lib|8080/,
  );
  assert.match(source, /alias \/var\/www\/timetable\/downloads\//);
});
test("systemd and environment isolate one unprivileged process with conservative private storage limits", async () => {
  const unit = await read("tangent-snapshots.service"),
    env = Object.fromEntries(
      (await read("cloud.env.example"))
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
  assert.match(unit, /^User=tangent$/m);
  assert.match(unit, /^Group=tangent$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/tangent-snapshots$/m);
  assert.match(unit, /^UMask=0077$/m);
  assert.match(unit, /^MemoryMax=256M$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /current\/cloud\/server\.mjs/);
  assert.equal(env.SNAPSHOT_DATA_DIR, "/var/lib/tangent-snapshots");
  assert.equal(env.PORT, "9001");
  assert.equal(env.SNAPSHOT_ALLOWED_ORIGIN, "https://timetable.zozovip.work");
  assert.equal(Number(env.SNAPSHOT_MAX_TOTAL_BYTES), 256 * 1024 * 1024);
  assert.equal(Number(env.SNAPSHOT_MAX_VAULT_BYTES), 32 * 1024 * 1024);
});
test("package guard rejects paths, runtime data, private files, archive nesting and secret headers", () => {
  for (const file of [
    "../outside",
    "/root/secret",
    "web\\x",
    "data/account.json",
    "web/account.key",
    "node_modules/x.js",
    "cloud/private-snapshots/uuid.json",
    "web/old.zip",
  ])
    assert.throws(() => rejectPrivateFile(file, Buffer.from("fixture")));
  assert.equal(safeRelative("web/assets/index-A01.js"), true);
  assert.throws(
    () =>
      rejectPrivateFile(
        "web/bad.txt",
        Buffer.from(["-----BEGIN", "OPENSSH", "PRIVATE KEY-----"].join(" ")),
      ),
    /Possible secret/,
  );
  assert.throws(
    () => rejectPrivateFile("web/key.txt", Buffer.from("sk-" + "x".repeat(32))),
    /Possible secret/,
  );
});

async function fixture() {
  const parent = path.join(projectRoot, "work", "local-first-deployment-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const web = path.join(root, "src", "frontend", "dist");
  await mkdir(path.join(web, "pwa"), { recursive: true });
  await mkdir(path.join(web, "assets"));
  await writeFile(
    path.join(web, "index.html"),
    "<!doctype html><title>Fixture local-first</title>",
  );
  await writeFile(
    path.join(web, "manifest.webmanifest"),
    JSON.stringify({ start_url: "/", scope: "/", display: "standalone" }),
  );
  await writeFile(path.join(web, "sw.js"), "// fixture offline resources");
  await writeFile(
    path.join(web, "assets", "index.js"),
    "/* tangent-timetable-local-v1 tangent-private-backup-v1 tangent-encrypted-snapshot */",
  );
  await writeFile(
    path.join(web, "assets", "pdf.worker.mjs"),
    "export const fixture = true;",
  );
  for (const size of [192, 512])
    await writeFile(
      path.join(web, "pwa", `icon-${size}.png`),
      Buffer.from([137, 80, 78, 71]),
    );
  await mkdir(path.join(root, "src"), { recursive: true });
  // Copy only the runtime allowlist, not the real source's ignored test output.
  await mkdir(path.join(root, "src", "cloud", "test"), { recursive: true });
  for (const file of [
    "server.mjs",
    "package.json",
    "README.md",
    "SECURITY_REVIEW.md",
    "deployment.env.example",
    "test/server.test.mjs",
  ]) {
    await cp(
      path.join(projectRoot, "src", "cloud", file),
      path.join(root, "src", "cloud", file),
    );
  }
  await mkdir(path.join(root, "deployment"), { recursive: true });
  await cp(directory, path.join(root, "deployment", "local-first"), {
    recursive: true,
  });
  const close = async () => {
    assert.ok(root.startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  };
  return { root, web, output: path.join(root, "releases", "fixture"), close };
}
test("pure-Node packager produces a checksummed standalone directory and detects file changes/unlisted data", async () => {
  const f = await fixture();
  try {
    const result = await createLocalFirstPackage({
      projectRoot: f.root,
      output: f.output,
      version: "2026.10.18-test.1",
      sourceCommit: null,
      sourceDirty: true,
    });
    assert.ok(result.files > 10);
    assert.equal(
      (await verifyReleasePackage(f.output)).version,
      "2026.10.18-test.1",
    );
    await assert.rejects(
      createLocalFirstPackage({
        projectRoot: f.root,
        output: f.output,
        version: "v2",
      }),
      /already exists/,
    );
    await writeFile(
      path.join(f.output, "web", "assets", "index.js"),
      "tampered",
    );
    await assert.rejects(verifyReleasePackage(f.output), /checksum mismatch/);
  } finally {
    await f.close();
  }
});
test("packager refuses obsolete online builds and source files that could contain private material", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.web, "assets", "index.js"),
      "// old Java-backed web build",
    );
    await assert.rejects(
      createLocalFirstPackage({
        projectRoot: f.root,
        output: f.output,
        version: "v1",
      }),
      /local-first/,
    );
    await writeFile(
      path.join(f.web, "assets", "index.js"),
      "/* tangent-timetable-local-v1 tangent-private-backup-v1 tangent-encrypted-snapshot */",
    );
    await writeFile(path.join(f.web, "account.key"), "fixture-not-real");
    await assert.rejects(
      createLocalFirstPackage({
        projectRoot: f.root,
        output: f.output,
        version: "v1",
      }),
      /Forbidden private/,
    );
    await assert.rejects(
      createLocalFirstPackage({
        projectRoot: f.root,
        output: f.root,
        version: "../escape",
      }),
      /Version/,
    );
  } finally {
    await f.close();
  }
});
test("zero-dependency preview serves only web/API on loopback, preserves private snapshots across restart, and rejects foreign origins", async () => {
  const f = await fixture();
  let server;
  try {
    await createLocalFirstPackage({
      projectRoot: f.root,
      output: f.output,
      version: "2026.10.18-test.2",
      sourceCommit: null,
      sourceDirty: true,
    });
    server = await startPreview({ root: f.output, port: 0 });
    await checkPublicSite(server.origin);
    const worker = await fetch(`${server.origin}/assets/pdf.worker.mjs`);
    assert.match(worker.headers.get("content-type"), /javascript/);
    assert.equal(worker.headers.get("x-content-type-options"), "nosniff");
    const registration = await fetch(`${server.origin}/api/v1/vaults`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: "{}",
    });
    assert.equal(registration.status, 201);
    const credential = await registration.json();
    for (const route of [
      `/data/${credential.vaultId}/index.json`,
      "/cloud/server.mjs",
      "/deployment/cloud.env.example",
      "/%2e%2e%2fdata/index.json",
    ])
      assert.equal((await fetch(server.origin + route)).status, 404);
    assert.equal(
      (
        await fetch(`${server.origin}/api/v1/snapshots`, {
          headers: { Origin: "https://foreign.example.test" },
        })
      ).status,
      403,
    );
    await server.close();
    server = undefined;
    await assert.rejects(verifyReleasePackage(f.output), /unlisted files/);
    server = await startPreview({ root: f.output, port: 0 });
    const list = await fetch(`${server.origin}/api/v1/snapshots`, {
      headers: {
        Authorization: `Bearer ${credential.vaultId}.${credential.token}`,
      },
    });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).items, []);
  } finally {
    if (server) await server.close();
    await f.close();
  }
});
