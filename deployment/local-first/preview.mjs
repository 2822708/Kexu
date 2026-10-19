import http from "node:http";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyReleasePackage } from "./verify-package.mjs";

const inside = (parent, child) => {
  const value = path.relative(parent, child);
  return (
    value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(value)
  );
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function startPreview({ root, dataDir, port = 17827 } = {}) {
  const packageRoot = path.resolve(
    root ?? fileURLToPath(new URL("..", import.meta.url)),
  );
  const privateDir = path.resolve(dataDir ?? path.join(packageRoot, "data"));
  if (
    privateDir === packageRoot ||
    inside(privateDir, packageRoot) ||
    (inside(packageRoot, privateDir) &&
      privateDir !== path.join(packageRoot, "data"))
  )
    throw new Error(
      "Choose package/data or a private data directory outside the package",
    );
  await verifyReleasePackage(packageRoot, { allowRuntimeData: true });
  const { createSnapshotServer } = await import(
    pathToFileURL(path.join(packageRoot, "cloud", "server.mjs")).href
  );
  const backend = await createSnapshotServer({
    dataDir: privateDir,
    limits: {
      totalBytes: 256 * 1024 * 1024,
      vaultBytes: 32 * 1024 * 1024,
      vaultSnapshots: 20,
      vaultCount: 16,
    },
  });
  await new Promise((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(0, "127.0.0.1", resolve);
  });
  const backendPort = backend.address().port;
  const webRoot = path.join(packageRoot, "web");
  const sendError = (res, status) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(`${status}\n`);
  };
  let actualPort = port;
  const front = http.createServer(async (req, res) => {
    const host = req.headers.host;
    if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(host))
      return sendError(res, 403);
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        `http://127.0.0.1:${actualPort}`,
        `http://localhost:${actualPort}`,
      ].includes(origin)
    )
      return sendError(res, 403);
    try {
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (url.pathname.startsWith("/api/v1/")) {
        const proxy = http.request(
          {
            hostname: "127.0.0.1",
            port: backendPort,
            path: url.pathname + url.search,
            method: req.method,
            headers: Object.fromEntries(
              ["authorization", "content-type", "content-length", "origin"]
                .filter((name) => req.headers[name] !== undefined)
                .map((name) => [name, req.headers[name]]),
            ),
          },
          (reply) => {
            res.writeHead(reply.statusCode ?? 502, {
              ...reply.headers,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            reply.pipe(res);
          },
        );
        proxy.setTimeout(30_000, () => proxy.destroy());
        proxy.on("error", () => {
          if (!res.headersSent) sendError(res, 502);
          else res.end();
        });
        req.on("aborted", () => proxy.destroy());
        req.pipe(proxy);
        return;
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/releases/")
      )
        return sendError(res, 404);
      if (!["GET", "HEAD"].includes(req.method)) return sendError(res, 405);
      let relative;
      try {
        relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      } catch {
        return sendError(res, 400);
      }
      if (
        relative.includes("\\") ||
        relative.includes("\0") ||
        relative
          .split("/")
          .some((part) => part.startsWith(".") || part === "..")
      )
        return sendError(res, 404);
      let file = path.resolve(webRoot, relative || "index.html");
      if (!inside(webRoot, file)) return sendError(res, 404);
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) return sendError(res, 404);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (
          path.extname(relative) ||
          relative.startsWith("assets/") ||
          relative.startsWith("pwa/")
        )
          return sendError(res, 404);
        file = path.join(webRoot, "index.html");
      }
      // No URL, including an encoded path, may traverse an intermediate symlink.
      let parent = webRoot;
      for (const segment of path.relative(webRoot, file).split(path.sep)) {
        parent = path.join(parent, segment);
        if ((await lstat(parent)).isSymbolicLink()) return sendError(res, 404);
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": bytes.length,
        "Cache-Control":
          path.basename(file) === "sw.js" || file.endsWith("index.html")
            ? "no-store"
            : "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      if (!res.headersSent) sendError(res, 500);
      else res.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      front.once("error", reject);
      front.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await new Promise((resolve) => backend.close(resolve));
    throw error;
  }
  actualPort = front.address().port;
  const close = async () => {
    await new Promise((resolve) => front.close(resolve));
    await new Promise((resolve) => backend.close(resolve));
  };
  return {
    origin: `http://127.0.0.1:${actualPort}`,
    dataDir: privateDir,
    close,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let dataDir;
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--data-dir" || !args[1])
      throw new Error(
        "Usage: node deployment/preview.mjs [--data-dir PRIVATE_DIRECTORY]",
      );
    dataDir = args[1];
  }
  const server = await startPreview({ dataDir });
  console.log(
    `Tangent local-first: ${server.origin}\nSnapshot data: ${server.dataDir}\nOnly this computer can connect. Use the HTTPS deployment for phones.`,
  );
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      void server.close().catch(() => {
        process.exitCode = 1;
      });
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
