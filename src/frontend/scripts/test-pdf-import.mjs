import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs'
import ts from 'typescript'

// A school-style PDF with a vector grid and nonembedded Chinese CID font.
// High-resolution rendering alone cannot recover the text without the CMap.
function chineseTimetablePdf() {
  const drawing = '0 0 0 RG 15 100 270 70 re S\nBT /F1 20 Tf 28 124 Td <9AD87B4965705B66> Tj ET'
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

test('extracts Chinese course names from a PDF that requires an external CMap', async () => {
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
      version,
      GlobalWorkerOptions: {},
      getDocument(options) {
        assert.equal(options.cMapUrl, `${assetPath}cmaps/`)
        assert.equal(options.standardFontDataUrl, `${assetPath}standard_fonts/`)
        assert.equal(options.wasmUrl, `${assetPath}wasm/`)
        // Read the same packaged vendor files from disk in the Node test runner.
        return getDocument({
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
  const material = await exports.prepareImportFile(chineseTimetablePdf())
  assert.equal(material.text, '第 1 页：高等数学')
  assert.deepEqual(material.images, [], 'readable PDF text should not be replaced by a grid screenshot')
})
