import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function checkCloud(origin) {
  const response = await fetch(`${origin}/api/v1/health`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "cloud health status");
  assert.deepEqual(await response.json(), { status: "ok", protocol: 1 });
}
export async function checkPublicSite(origin) {
  await checkCloud(origin);
  const results = [];
  for (const [route, expected] of [
    ["/", 200],
    ["/todos", 200],
    ["/manifest.webmanifest", 200],
    ["/sw.js", 200],
    ["/api/v1/snapshots", 401],
    ["/api/courses", 404],
    ["/api/ai/chat", 404],
    ["/assets/missing-acceptance-check.js", 404],
  ]) {
    const response = await fetch(`${origin}${route}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, expected, route);
    if (route === "/sw.js" || route.startsWith("/api/"))
      assert.match(
        response.headers.get("cache-control") ?? "",
        /no-store/i,
        `${route} cache policy`,
      );
    if (route === "/manifest.webmanifest") {
      const manifest = await response.json();
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.scope, "/");
    } else await response.arrayBuffer();
    results.push({ route, status: expected });
  }
  return results;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !["--cloud", "--preview", "--https"].includes(mode)
  )
    throw new Error(
      "Usage: node deployment/healthcheck.mjs --cloud|--preview|--https",
    );
  if (mode === "--cloud") {
    await checkCloud("http://127.0.0.1:9001");
    console.log("Cloud health passed");
  } else
    console.log(
      JSON.stringify(
        await checkPublicSite(
          mode === "--https"
            ? "https://timetable.zozovip.work"
            : "http://127.0.0.1:17827",
        ),
        null,
        2,
      ),
    );
}
