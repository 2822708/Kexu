import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { getDocument, OPS, version } from 'pdfjs-dist/legacy/build/pdf.mjs'
import ts from 'typescript'

// A school-style PDF with a vector grid and nonembedded Chinese CID font.
// High-resolution rendering alone cannot recover the text without the CMap.
function chineseTimetablePdf() {
  const drawing = [
    '0 0 0 RG 15 100 270 70 re S',
    'BT /F1 20 Tf 1 0 0 1 28 150 Tm <54684E00> Tj 1 0 0 1 155 150 Tm <54684E8C> Tj',
    '1 0 0 1 28 124 Tm <9AD87B4965705B66> Tj 1 0 0 1 155 124 Tm <59275B6682F18BED> Tj ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -141 1000 859] /Ascent 752 /Descent -271 /CapHeight 737 /StemV 58 >>',
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return String(offset).padStart(10, '0') + ' 00000 n \n'
  })
  const xref = pdf.length
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new File([pdf], 'synthetic-timetable.pdf', { type: 'application/pdf' })
}

function loadImportFiles(getPdf = getDocument) {
  const source = readFileSync(new URL('../src/utils/importFiles.ts', import.meta.url), 'utf8')
    .replace('import.meta.env.BASE_URL', "'/Kexu/'")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const exports = {}
  const packagePath = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url))
    .replaceAll('\\', '/')
  const assetPath = `/Kexu/assets/pdfjs-${version}/`
  const sourceModules = {
    'pdfjs-dist': {
      OPS,
      version,
      GlobalWorkerOptions: {},
      getDocument(options) {
        assert.equal(options.cMapUrl, `${assetPath}cmaps/`)
        assert.equal(options.standardFontDataUrl, `${assetPath}standard_fonts/`)
        assert.equal(options.wasmUrl, `${assetPath}wasm/`)
        // Read the same packaged vendor files from disk in the Node test runner.
        return getPdf({
          ...options,
          cMapUrl: options.cMapUrl.replace(assetPath, packagePath),
          standardFontDataUrl: options.standardFontDataUrl.replace(assetPath, packagePath),
          wasmUrl: options.wasmUrl.replace(assetPath, packagePath),
        })
      },
    },
    'pdfjs-dist/build/pdf.worker.min.mjs?url': { default: 'unused-by-node' },
  }
  new Function('exports', 'require', outputText)(exports, (id) => {
    assert.ok(Object.hasOwn(sourceModules, id), `Unexpected import: ${id}`)
    return sourceModules[id]
  })
  return exports
}

test('extracts Chinese PDF cells using the external CMap and preserves rows and columns', async () => {
  const material = await loadImportFiles().prepareImportFile(chineseTimetablePdf())
  assert.equal(material.text, '第 1 页：周一\t周二\n高等数学\t大学英语')
  assert.deepEqual(material.images, [], 'readable PDF text should not be replaced by a grid screenshot')
})

function mockPdf(pages) {
  let destroyed = false
  const rendered = []
  const canvases = []
  const prepare = loadImportFiles(() => ({ promise: Promise.resolve({
    numPages: pages.length,
    async getPage(number) {
      const [text, imageFootprint] = pages[number - 1]
      return {
        async getTextContent() { return { items: text ? [{ str: text, hasEOL: true }] : [] } },
        async getOperatorList() {
          return imageFootprint
            ? {
                fnArray: [OPS.save, OPS.transform, OPS.restore, OPS.paintFormXObjectBegin, OPS.paintImageXObject, OPS.paintFormXObjectEnd],
                argsArray: [null, [500, 0, 0, 700, 0, 0], null, [[imageFootprint[0], 0, 0, imageFootprint[1], 40, 20]], ['image', 500, 700], null],
              }
            : { fnArray: [], argsArray: [] }
        },
        getViewport({ scale }) { return { width: 612 * scale, height: 792 * scale } },
        render() { rendered.push(number); return { promise: Promise.resolve() } },
        cleanup() {},
      }
    },
    async destroy() { destroyed = true },
  }) })).prepareImportFile
  return {
    async extract() {
      const previousDocument = globalThis.document
      globalThis.document = { createElement() {
        const canvas = {
          getContext: () => ({ fillRect() {} }),
          toBlob(callback) { callback(new Blob(['JPEG'])) },
        }
        canvases.push(canvas)
        return canvas
      } }
      try {
        return await prepare(chineseTimetablePdf())
      } finally {
        assert.equal(destroyed, true)
        assert.ok(canvases.every(({ width, height }) => width === 0 && height === 0))
        globalThis.document = previousDocument
      }
    },
    rendered,
  }
}

test('scanned pages with a text footer retain their position between readable pages', async () => {
  const pdf = mockPdf([['周一 高等数学'], ['页码 2', [550, 650]], ['周三 大学英语'], ['']])
  const material = await pdf.extract()
  assert.equal(material.text, [
    '第 1 页：周一 高等数学',
    '第 2 页：\n【扫描页待识别：synthetic-timetable-第2页.jpg】',
    '第 3 页：周三 大学英语',
    '第 4 页：\n【扫描页待识别：synthetic-timetable-第4页.jpg】',
  ].join('\n\n'))
  assert.deepEqual(material.images.map(({ name }) => name), ['synthetic-timetable-第2页.jpg', 'synthetic-timetable-第4页.jpg'])
  assert.deepEqual(pdf.rendered, [2, 4])
})

test('short readable pages with a small high-resolution logo do not consume the scan limit', async () => {
  const pdf = mockPdf(Array.from({ length: 4 }, (_, index) => [`第${index + 1}周`, [42, 44]]))
  const material = await pdf.extract()
  assert.equal(material.text, '第 1 页：第1周\n\n第 2 页：第2周\n\n第 3 页：第3周\n\n第 4 页：第4周')
  assert.deepEqual(pdf.rendered, [])
})

test('an over-limit file reports all scan page numbers before rendering or partially importing', async () => {
  const pdf = mockPdf([[''], ['周二'], [''], [''], ['']])
  await assert.rejects(pdf.extract(), /第 1、3、4、5 页需要识别图片/)
  assert.deepEqual(pdf.rendered, [])
})

test('HTML rows and cells survive import and invalid numeric entities cannot break the file', async () => {
  const document = new File([
    '<script>alert(1)</script><table><tr><th>周一</th><th>周二</th></tr>\n'
      + '<tr><td>高数<br>101</td><td>英语&nbsp;205&#999999999;</td></tr></table>',
  ], '课程表.html')
  const material = await loadImportFiles().prepareImportFile(document)
  assert.equal(material.text, '周一\t周二\n高数\n101\t英语 205\ufffd')
})

test('opens BOM-marked UTF-16 timetable tables without corrupting Chinese text', async () => {
  const table = new File([Buffer.from('\uFEFF周一,周二\n高数,英语', 'utf16le')], '课程表.csv')
  const material = await loadImportFiles().prepareImportFile(table)
  assert.equal(material.text, '周一,周二\n高数,英语')
})
