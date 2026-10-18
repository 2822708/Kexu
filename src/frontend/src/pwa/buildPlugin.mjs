import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
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
      const parsedBase = new URL(base, 'https://pwa.invalid')
      if (parsedBase.search || parsedBase.hash)
        throw new Error('Mobile PWA base cannot contain a query or fragment.')
      base = parsedBase.pathname
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
      const files = new Set()
      let totalBytes = 0
      for (const [file, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (file.endsWith('.map')) continue
        const source = item.type === 'chunk' ? item.code : item.source
        hash.update(file).update(source)
        totalBytes += Buffer.byteLength(source)
        files.add(file)
      }
      const collectPublic = (directory, prefix = '') => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          const file = `${prefix}${entry.name}`
          if (entry.isDirectory()) collectPublic(resolve(directory, entry.name), `${file}/`)
          else if (entry.isSymbolicLink())
            throw new Error(`Mobile offline public assets must be regular files: ${file}`)
          else if (entry.isFile() && !file.endsWith('.map')) {
            if (['sw.js', 'manifest.webmanifest'].includes(file))
              throw new Error(`Reserved mobile PWA file in public/: ${file}`)
            const bytes = readFileSync(resolve(directory, entry.name))
            hash.update(file).update(bytes)
            totalBytes += bytes.byteLength
            files.add(file)
          }
        }
      }
      if (publicDir) collectPublic(publicDir)
      for (const required of ['index.html', 'pwa/icon-192.png', 'pwa/icon-512.png']) {
        if (!files.has(required))
          throw new Error(`Missing required mobile offline resource: ${required}`)
      }
      // Every lazy route, attachment parser and PDF worker must be available on the
      // first offline visit. Never silently downgrade to a shell-only installation.
      if (totalBytes > 40 * 1024 * 1024)
        throw new Error(
          'Mobile offline resources exceed 40 MiB; review the bundle before publishing.',
        )
      const manifest = {
        id: base,
        name: '大切课程表',
        short_name: '大切课表',
        description:
          '课表、待办与考试在本机保存，可离线读写；云端提供自动快照、手动恢复与版本分发。AI 需要联网。',
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
      const manifestSource = JSON.stringify(manifest, null, 2)
      files.add('manifest.webmanifest')
      const assets = [...files]
        .sort()
        .map((file) => `${base}${file.split('/').map(encodeURIComponent).join('/')}`)
      const precache = [...assets]
      hash.update(manifestSource)
      hash.update(createServiceWorkerSource({ version: 'template', base, assets, precache }))
      const version = hash.digest('hex').slice(0, 16)
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: manifestSource,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: createServiceWorkerSource({ version, base, assets, precache }),
      })
    },
  }
}
