export const MAX_IMPORT_FILE_BYTES = 12 * 1024 * 1024
export const MAX_IMPORT_TEXT_CHARS = 18000
export const MAX_PDF_PAGES = 12
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

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

async function extractPdf(file: File): Promise<string> {
  const [{ GlobalWorkerOptions, getDocument }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default
  const bytes = new Uint8Array(await file.arrayBuffer())
  const document = await getDocument({ data: bytes, isEvalSupported: false }).promise
  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页，请先拆分到需要导入的页面`)
    }
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const line = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
      if (line) pages.push(`第 ${pageNumber} 页：${line}`)
    }
    if (pages.length === 0) {
      throw new Error('PDF 没有可复制的文字层。请截取相关页面并以图片导入。')
    }
    return boundedText(pages.join('\n'))
  } finally {
    await document.destroy()
  }
}

export async function extractImportFileText(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('文件不能超过 12 MiB')
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'pdf' || file.type === 'application/pdf') return extractPdf(file)
  if (extension === 'docx') {
    if (file.size > 5 * 1024 * 1024) throw new Error('DOCX 文件不能超过 5 MiB')
    const mammoth = (await import('mammoth/mammoth.browser')).default
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return boundedText(result.value)
  }
  if (!['txt', 'md', 'csv', 'ics', 'html', 'htm'].includes(extension)) {
    throw new Error('支持 TXT、Markdown、CSV、ICS、HTML、PDF、DOCX 和常见截图格式')
  }
  const source = await readUtf8OrGb18030(file)
  if (extension === 'html' || extension === 'htm') {
    return boundedText(htmlText(source))
  }
  return boundedText(source)
}
