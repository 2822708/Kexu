import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'

const require = createRequire(import.meta.url)
const assetDirectories = ['cmaps', 'standard_fonts', 'wasm']
const mimeTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

export function pdfJsAssets() {
  const packageFile = require.resolve('pdfjs-dist/package.json')
  const packageRoot = dirname(packageFile)
  const { version } = JSON.parse(readFileSync(packageFile, 'utf8'))
  const prefix = `assets/pdfjs-${version}/`
  const assets = new Map([[`${prefix}LICENSE`, join(packageRoot, 'LICENSE')]])

  for (const directory of assetDirectories) {
    const assetDirectory = join(packageRoot, directory)
    for (const entry of readdirSync(assetDirectory, { withFileTypes: true })) {
      if (entry.isFile()) {
        assets.set(`${prefix}${directory}/${entry.name}`, join(assetDirectory, entry.name))
      }
    }
  }

  return {
    name: 'kexu-pdfjs-assets',
    configureServer(server) {
      // Vite calls this hook before its base middleware, so the base is still present.
      const base = server.config.base
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?', 1)[0]
        if (!pathname?.startsWith(`${base}${prefix}`)) return next()
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end()
          return
        }
        // Resolve only paths from the installed distribution, never from request input.
        const file = assets.get(pathname.slice(base.length))
        if (!file) {
          res.writeHead(404).end()
          return
        }
        const bytes = readFileSync(file)
        res.writeHead(200, {
          'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream',
          'Content-Length': bytes.length,
          'Cache-Control': 'no-store',
        }).end(req.method === 'HEAD' ? undefined : bytes)
      })
    },
    generateBundle(output, _bundle, isWrite) {
      // Avoid concurrent creation of the same parent directory on Windows.
      if (isWrite && output.dir) {
        for (const directory of assetDirectories) {
          mkdirSync(join(output.dir, prefix, directory), { recursive: true })
        }
      }
      // Emit before the post PWA plugin collects the offline asset list.
      for (const [fileName, file] of assets) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
      }
    },
  }
}
