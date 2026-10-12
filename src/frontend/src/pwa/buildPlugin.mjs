import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServiceWorkerSource } from './serviceWorkerSource'

export function mobilePwa() {
  let base = '/'
  let publicDir = ''
  return {
    name: 'tangent-mobile-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      base = config.base
      publicDir = config.publicDir
      if (!base.startsWith('/') || !base.endsWith('/')) {
        throw new Error('Mobile PWA requires an absolute local base, such as / or /timetable/.')
      }
    },
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` },
          injectTo: 'head',
        },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: `${base}pwa/icon-192.png` },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
          injectTo: 'head',
        },
      ]
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const allAssets = []
      const initial = new Set(['index.html', 'pwa/icon-192.png', 'pwa/icon-512.png'])
      const collect = (file) => {
        if (initial.has(file)) return
        initial.add(file)
        const item = bundle[file]
        if (item?.type === 'chunk') item.imports.forEach(collect)
      }
      for (const [file, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (file.endsWith('.map')) continue
        hash.update(file).update(item.type === 'chunk' ? item.code : item.source)
        allAssets.push(`${base}${file}`)
        if (item.type === 'chunk' && item.isEntry) collect(file)
        if (file.endsWith('.css')) initial.add(file)
      }
      const assets = [...allAssets, `${base}pwa/icon-192.png`, `${base}pwa/icon-512.png`]
      const precache = [...initial].map((file) => `${base}${file}`)
      hash.update(createServiceWorkerSource({ version: 'template', base, assets, precache }))
      for (const size of [192, 512])
        hash.update(readFileSync(resolve(publicDir, `pwa/icon-${size}.png`)))
      const version = hash.digest('hex').slice(0, 16)
      const manifest = {
        id: base,
        name: '大切课程表',
        short_name: '大切课表',
        description: '课表、待办与 AI 助手。业务数据需要连接服务。',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f5f0eb',
        theme_color: '#2d2d2d',
        icons: [192, 512].map((size) => ({
          src: `${base}pwa/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: 'image/png',
          purpose: 'any maskable',
        })),
      }
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(manifest, null, 2),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: createServiceWorkerSource({ version, base, assets, precache }),
      })
    },
  }
}
