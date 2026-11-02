#!/usr/bin/env node
/**
 * 包体积预算检查（性能预算的静态部分）。
 *
 * 阈值按 2026-11-01 实测值留约 7% 余量，用于拦住“悄悄把大依赖打进首屏”这类回归。
 * 不测量运行时性能，只比较构建产物的 gzip 体积。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist/assets'
const BUDGETS = [
  { name: 'total', label: '全部 JS/CSS', maxKb: 1150, match: () => true },
  { name: 'entry', label: '业务入口 (index-*.js)', maxKb: 65, match: (name) => /^index-.*\.js$/.test(name) },
  { name: 'vendor', label: '最大单个 chunk', maxKb: 400, match: () => true, single: true },
]

const rows = readdirSync(DIST)
  .filter((name) => /\.(js|mjs|css)$/.test(name))
  .map((name) => {
    const bytes = readFileSync(join(DIST, name))
    return { name, kb: gzipSync(bytes, { level: 9 }).length / 1024 }
  })
  .sort((a, b) => b.kb - a.kb)

if (rows.length === 0) {
  console.error('未找到构建产物，请先运行 npm run build')
  process.exit(1)
}

const failures = []
const total = rows.reduce((sum, row) => sum + row.kb, 0)
const largest = rows[0]

for (const budget of BUDGETS) {
  const actual = budget.single
    ? largest.kb
    : budget.name === 'total'
      ? total
      : rows.filter((row) => budget.match(row.name)).reduce((sum, row) => sum + row.kb, 0)
  const ok = actual <= budget.maxKb
  const label = budget.single ? `${budget.label}（${largest.name}）` : budget.label
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual.toFixed(1)} KB / ${budget.maxKb} KB`)
  if (!ok) failures.push(label)
}

console.log('\n最大的 5 个产物:')
for (const row of rows.slice(0, 5)) {
  console.log(`  ${row.name.padEnd(32)} ${row.kb.toFixed(1).padStart(7)} KB`)
}

if (failures.length > 0) {
  console.error(`\n超出预算: ${failures.join('、')}`)
  process.exit(1)
}
