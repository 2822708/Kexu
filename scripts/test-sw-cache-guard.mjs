#!/usr/bin/env node
/*
 * SW 缓存毒化防护回归测试（对应 HANDOVER 3.17 第 2 条硬约束）。
 *
 * 背景：SPA 兜底（SpaErrorViewResolver）会把服务端不存在的路径返回 index.html
 * （200 + text/html）。sw.js 的 stale-while-revalidate 分支如果照单全收任何
 * 200 响应，HTML 就会以 .js 之名毒化缓存条目——之后每次加载都拿 HTML 当脚本
 * 执行，且要等 bump CACHE 才清得掉。
 *
 * 前置条件（这不是单元测试，是端到端探针）：
 *   1. 17817 端口上跑着 standalone jar（含最新 static 产物）：
 *        java -jar target/timetable-backend-1.0.0.jar \
 *          --spring.profiles.active=standalone --server.port=17817
 *   2. 有 playwright：npm i -g playwright（或设置 PLAYWRIGHT 路径）
 *   3. root 身份运行时浏览器需要 --no-sandbox（脚本已带）
 *
 * 判定：
 *   - 正对照：reload 后真实资产必须进缓存（否则说明 SW 没接管，测试前提不成立）
 *   - 主断言：对「jar 里不存在的 chunk 名」发起页面内 fetch，缓存里不得出现该条目
 *
 * 用法：node scripts/test-sw-cache-guard.mjs
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const BASE = process.env.SW_TEST_BASE || 'http://127.0.0.1:17817'
const BOGUS = '/assets/index-SW-GUARD-PROBE-NOT-REAL.js'
const require = createRequire(import.meta.url)

function loadChromium() {
  if (process.env.PLAYWRIGHT_PATH) {
    return require(process.env.PLAYWRIGHT_PATH).chromium
  }
  try {
    return require('playwright').chromium
  } catch {
    // 回退到全局安装（npm i -g playwright）
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim()
    return require(path.join(globalRoot, 'playwright')).chromium
  }
}

async function cacheUrls(page) {
  return page.evaluate(async () => {
    const out = []
    for (const key of await caches.keys()) {
      const cache = await caches.open(key)
      for (const req of await cache.keys()) out.push(req.url)
    }
    return out
  })
}

const chromium = loadChromium()
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage()
  await page.goto(BASE + '/', { waitUntil: 'load' })

  const state = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => r.active && r.active.state),
  )
  if (state !== 'activated') throw new Error(`SW 未激活（${state}），测试前提不成立`)

  // 第二次加载才会被 SW 接管（首次加载时 SW 还没激活），应用的 chunk 由此进入 SWR 分支
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2000)

  const realCached = (await cacheUrls(page)).filter((u) => u.includes('/assets/'))
  if (realCached.length === 0) throw new Error('正对照失败：没有任何真实资产进缓存，SW 可能没接管页面')

  const resp = await page.evaluate(async (url) => {
    const r = await fetch(url)
    return { status: r.status, type: r.headers.get('content-type') || '' }
  }, BOGUS)
  if (resp.status !== 200 || !resp.type.includes('text/html')) {
    throw new Error(`前提不成立：不存在 chunk 的响应是 ${JSON.stringify(resp)}，期望 200 text/html（SPA 兜底）`)
  }

  await page.waitForTimeout(1000)
  const poisoned = (await cacheUrls(page)).filter((u) => u.includes('SW-GUARD-PROBE-NOT-REAL'))
  if (poisoned.length > 0) {
    console.error(`FAIL: HTML 被毒化进 .js 缓存条目：${poisoned.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`PASS: 兜底 HTML 未进缓存；真实资产 ${realCached.length} 个正常缓存`)
  }
} finally {
  await browser.close()
}
