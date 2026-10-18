#!/usr/bin/env node
/**
 * 把前端构建产物同步进后端 static 目录，供单机版（standalone profile）直接托管。
 *
 * 用法（在仓库根执行）：
 *   node scripts/sync-frontend-dist.mjs
 *
 * 为什么要手动同步而不是 maven 自动构建前端：node_modules 已在开发机就绪，
 * 每次打包让 maven 重新 npm install 太慢；这个脚本是构建流程里明确的一步，
 * 忘了执行的表现是「桌面版还是旧页面」，足够容易被发现。
 */
import { cp, rm, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'src/frontend/dist')
const staticDir = path.join(root, 'src/backend/src/main/resources/static')

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

if (!(await exists(dist))) {
  console.error(`[sync] 找不到 ${dist} —— 请先在 src/frontend 执行 npm run build`)
  process.exit(1)
}

// 清掉旧产物，避免删掉的前端 chunk 残留在 jar 里被缓存咬住
await rm(staticDir, { recursive: true, force: true })
await mkdir(staticDir, { recursive: true })
await cp(dist, staticDir, { recursive: true })

console.log(`[sync] ${path.relative(root, dist)} -> ${path.relative(root, staticDir)} 完成`)
