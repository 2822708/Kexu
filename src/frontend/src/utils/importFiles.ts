import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

export const MAX_IMPORT_FILE_BYTES = 12 * 1024 * 1024
export const MAX_IMPORT_TEXT_CHARS = 18000
export const MAX_PDF_PAGES = 12
export const MAX_PDF_IMAGE_PAGES = 3
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function importImageMarker(name: string): string {
  return `【扫描页待识别：${name}】`
}

export function replaceImportImageText(text: string, imageName: string, recognized: string): string | null {
  const lines = text.split('\n')
  const index = lines.indexOf(importImageMarker(imageName))
  if (index === -1) return null
  lines[index] = recognized
  return lines.join('\n')
}

/** Append a complete OCR result atomically; callers keep the source images on failure. */
export function mergeImportText(existingText: string, recognizedText: string): string {
  const recognized = recognizedText.trim()
  if (!recognized) throw new Error('图片中未识别到文字，原文字和图片已保留')
  const merged = existingText.trim() ? `${existingText}\n\n${recognized}` : recognized
  if (merged.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`合并后的导入文字超过 ${MAX_IMPORT_TEXT_CHARS} 字上限，原文字和图片已保留，请拆分后重试`)
  }
  return merged
}

export interface ImportFileMaterial {
  /** Text extracted locally. Scanned PDF pages can accompany partial text. */
  text: string | null
  /** Image files that need the configured vision service for text recognition. */
  images: File[]
}

export function isSupportedImage(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type.toLowerCase())
    || (!file.type || file.type === 'application/octet-stream'
      ? ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)
      : false)
}

function boundedText(text: string): string {
  const cleaned = text.split('\u0000').join('').trim()
  if (!cleaned) throw new Error('文件中没有可读取的文字')
  if (cleaned.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(`提取内容超过 ${MAX_IMPORT_TEXT_CHARS} 个字符，请拆分文件后重试`)
  }
  return cleaned
}

async function readImportText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

function htmlText(source: string): string {
  const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript|svg|iframe|object|embed|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/<\/t[dh]\s*>\s*<t[dh]\b[^>]*>/gi, '\t')
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, value: string) => {
      const entity = value.toLowerCase()
      if (entity[0] !== '#') return entities[entity]
      const hex = entity[1] === 'x'
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
    })
    .replace(/ *([\n\t]) */g, '$1')
    .replace(/\n{3,}/g, '\n\n')
}

let resolversReady = false

/**
 * PDF.js 5 uses Promise.withResolvers, which is missing before Chrome 119 / Android
 * WebView 119. Older WebView shells would otherwise fail every PDF import.
 */
function ensurePromiseWithResolvers(): void {
  if (resolversReady) return
  const target = Promise as unknown as {
    withResolvers?: <T>() => {
      promise: Promise<T>
      resolve: (value: T | PromiseLike<T>) => void
      reject: (reason?: unknown) => void
    }
  }
  if (typeof target.withResolvers !== 'function') {
    target.withResolvers = <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
      })
      return { promise, resolve, reject }
    }
  }
  resolversReady = true
}

async function loadPdfJs() {
  ensurePromiseWithResolvers()
  const [{ GlobalWorkerOptions, getDocument, OPS, version }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default
  return { getDocument, OPS, assets: `${import.meta.env.BASE_URL}assets/pdfjs-${version}/` }
}

function safeFileStem(name: string): string {
  return (name.replace(/\.[^.]+$/, '') || 'PDF')
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .slice(0, 80)
}

function pdfPageImageName(stem: string, page: number): string {
  return `${stem}-第${page}页.jpg`
}

function pdfTextLines(items: TextItem[]): string {
  const lines: string[] = []
  let line = ''
  let previous: TextItem | undefined
  for (const item of items) {
    const horizontal = item.dir === 'ltr' && Math.abs(item.transform[0]) > Math.abs(item.transform[1])
    if (line && previous && horizontal && previous.dir === 'ltr') {
      const height = Math.max(item.height, previous.height, 1)
      const sameLine = Math.abs(item.transform[5] - previous.transform[5]) < height * 0.65
      if (!sameLine) {
        lines.push(line.trim())
        line = ''
      } else {
        const gap = item.transform[4] - previous.transform[4] - previous.width
        // A substantial blank span usually separates cells in a course timetable.
        const wideSpace = !item.str.trim() && item.width > height * 1.5
        if (gap > height * 1.5 || wideSpace) line = `${line.trimEnd()}\t`
        else if (gap > height * 0.12 && !/\s$/.test(line)) line += ' '
      }
    }
    line += item.str
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim())
      line = ''
    }
    previous = item
  }
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n').replace(/ *\t */g, '\t')
}

async function hasScannedContent(page: PDFPageProxy, ops: typeof import('pdfjs-dist')['OPS']): Promise<boolean> {
  const viewport = page.getViewport({ scale: 1 })
  const minimumImageArea = viewport.width * viewport.height * 0.15
  const savedAreas: number[] = []
  let imageArea = 1
  const { fnArray, argsArray } = await page.getOperatorList()
  return fnArray.some((operation, index) => {
    if (operation === ops.save || operation === ops.paintFormXObjectBegin || operation === ops.beginGroup) {
      savedAreas.push(imageArea)
    }
    if (operation === ops.restore || operation === ops.paintFormXObjectEnd || operation === ops.endGroup) {
      imageArea = savedAreas.pop() ?? 1
    }
    const matrix = operation === ops.transform ? argsArray[index]
      : operation === ops.paintFormXObjectBegin ? argsArray[index][0] : null
    if (matrix) {
      const [a, b, c, d] = matrix
      // PDF draws raster images over a unit square. The transform scales its area
      // independently of the raster resolution (for example a small school logo).
      imageArea *= Math.abs(a * d - b * c)
    }
    if (imageArea < minimumImageArea) return false
    if (operation === ops.paintImageXObject) {
      const [, width, height] = argsArray[index]
      return width >= 320 && height >= 320
    }
    if (operation === ops.paintInlineImageXObject) {
      const [image] = argsArray[index]
      return image?.width >= 320 && image?.height >= 320
    }
    return false
  })
}

async function renderPdfPages(
  pdfDocument: PDFDocumentProxy,
  stem: string,
  pageNumbers: number[],
): Promise<File[]> {
  const images: File[] = []
  for (const pageNumber of pageNumbers) {
    const canvas = document.createElement('canvas')
    const page = await pdfDocument.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, 2200 / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('当前浏览器无法渲染 PDF 页面')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (next: Blob | null) => next ? resolve(next) : reject(new Error('PDF 页面转换图片失败')),
          'image/jpeg',
          0.9,
        )
      })
      images.push(new File([blob], pdfPageImageName(stem, pageNumber), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }))
    } finally {
      canvas.width = canvas.height = 0
      page.cleanup()
    }
  }
  return images
}

async function extractPdfMaterial(file: File): Promise<ImportFileMaterial> {
  const { getDocument, OPS, assets } = await loadPdfJs()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdfDocument = await getDocument({
    data: bytes,
    isEvalSupported: false,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
  }).promise
  try {
    if (pdfDocument.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页，请先拆分到需要导入的页面`)
    }
    const stem = safeFileStem(file.name)
    const pages: string[] = []
    const imagePages: number[] = []
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const text = pdfTextLines(content.items.filter((item) => 'str' in item))
        // A short title or page number can sit above a scanned timetable image.
        const sparseText = text.replace(/[^\p{L}\p{N}]/gu, '').length < 32
        if (!text || (sparseText && await hasScannedContent(page, OPS))) {
          imagePages.push(pageNumber)
          pages.push(`第 ${pageNumber} 页：\n${importImageMarker(pdfPageImageName(stem, pageNumber))}`)
        } else {
          pages.push(`第 ${pageNumber} 页：${text}`)
        }
      } finally {
        page.cleanup()
      }
    }
    if (imagePages.length > MAX_PDF_IMAGE_PAGES) {
      throw new Error(`PDF 的第 ${imagePages.join('、')} 页需要识别图片。每次最多导入 ${MAX_PDF_IMAGE_PAGES} 张扫描页，请拆分 PDF 后重试。`)
    }
    return {
      text: pages.length > imagePages.length ? boundedText(pages.join('\n\n')) : null,
      images: imagePages.length
        ? await renderPdfPages(pdfDocument, stem, imagePages)
        : [],
    }
  } finally {
    await pdfDocument.destroy()
  }
}

/**
 * Extract one import file without sending its contents anywhere.
 * PDF pages without a text layer are rendered to JPEG files for the caller's
 * explicit vision/OCR handoff.
 */
export async function prepareImportFile(file: File): Promise<ImportFileMaterial> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('文件不能超过 12 MiB')
  }
  if (isSupportedImage(file)) return { text: null, images: [file] }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'pdf' || file.type === 'application/pdf') return extractPdfMaterial(file)
  if (extension === 'docx') {
    if (file.size > 5 * 1024 * 1024) throw new Error('DOCX 文件不能超过 5 MiB')
    const mammoth = (await import('mammoth/mammoth.browser')).default
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { text: boundedText(result.value), images: [] }
  }
  if (!['txt', 'md', 'csv', 'ics', 'html', 'htm'].includes(extension)) {
    throw new Error('支持 TXT、Markdown、CSV、ICS、HTML、PDF、DOCX 和常见截图格式')
  }
  const source = await readImportText(file)
  return {
    text: extension === 'html' || extension === 'htm'
      ? boundedText(htmlText(source))
      : boundedText(source),
    images: [],
  }
}

/** Text-only compatibility helper for callers that cannot handle image handoff. */
export async function extractImportFileText(file: File): Promise<string> {
  const material = await prepareImportFile(file)
  if (!material.text) {
    throw new Error('PDF 页面没有可复制的文字层，需要作为图片交给支持图片的 AI 服务识别')
  }
  return material.text
}
