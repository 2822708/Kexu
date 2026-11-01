import type { PDFDocumentProxy } from 'pdfjs-dist'

export const MAX_IMPORT_FILE_BYTES = 12 * 1024 * 1024
export const MAX_IMPORT_TEXT_CHARS = 18000
export const MAX_PDF_PAGES = 12
export const MAX_PDF_IMAGE_PAGES = 3
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

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

async function readUtf8OrGb18030(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '')
  }
}

function htmlText(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript|svg|iframe|object|embed|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
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
  const [{ GlobalWorkerOptions, getDocument }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default
  return getDocument
}

function safeFileStem(name: string): string {
  return (name.replace(/\.[^.]+$/, '') || 'PDF')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 80)
}

async function renderPdfPages(
  pdfDocument: PDFDocumentProxy,
  sourceName: string,
  pageNumbers: number[],
): Promise<File[]> {
  const images: File[] = []
  const stem = safeFileStem(sourceName)
  for (const pageNumber of pageNumbers) {
    const page = await pdfDocument.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, 1800 / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
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
      images.push(new File([blob], `${stem}-第${pageNumber}页.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }))
    } finally {
      page.cleanup()
    }
  }
  return images
}

async function extractPdfMaterial(file: File): Promise<ImportFileMaterial> {
  const getDocument = await loadPdfJs()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdfDocument = await getDocument({ data: bytes, isEvalSupported: false }).promise
  try {
    if (pdfDocument.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页，请先拆分到需要导入的页面`)
    }
    const textPages: string[] = []
    const imagePages: number[] = []
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const line = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim()
        if (line) textPages.push(`第 ${pageNumber} 页：${line}`)
        else imagePages.push(pageNumber)
      } finally {
        page.cleanup()
      }
    }
    const textParts = textPages.length ? [textPages.join('\n')] : []
    const selectedImagePages = imagePages.slice(0, MAX_PDF_IMAGE_PAGES)
    if (imagePages.length > selectedImagePages.length) {
      textParts.push(
        `PDF 中另有 ${imagePages.length - selectedImagePages.length} 页扫描内容未附上，请拆分后导入。`,
      )
    }
    return {
      text: textParts.length ? boundedText(textParts.join('\n\n')) : null,
      images: selectedImagePages.length
        ? await renderPdfPages(pdfDocument, file.name, selectedImagePages)
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
  const source = await readUtf8OrGb18030(file)
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
