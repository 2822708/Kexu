import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/chatImport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

class FileReaderStub {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
      this.onload?.()
    }, () => this.onerror?.())
  }
}
const exports = {}
vm.runInNewContext(compiled, { exports, Blob, FileReader: FileReaderStub })
const { appendChatText, chatMaterialText, isImageDataUrl, MAX_CHAT_CHARS } = exports

test('import appends to an existing draft without losing its text', () => {
  assert.equal(appendChatText('原有安排', '新材料'), '原有安排\n\n新材料')
})

test('an over-limit import is rejected instead of truncating dates or material', () => {
  assert.equal(appendChatText('', 'x'.repeat(MAX_CHAT_CHARS)).length, MAX_CHAT_CHARS)
  assert.throws(() => appendChatText('已有草稿', 'x'.repeat(MAX_CHAT_CHARS)), /原草稿已保留/)
})

test('image material carries provenance and proposal-only instructions', () => {
  const prompt = chatMaterialText('安排\n\u0000.png', '2026-10-01 09:00 考试', true)
  assert.match(prompt, /图片文字识别/)
  assert.match(prompt, /确认前不要执行操作/)
  assert.ok(prompt.includes('2026-10-01 09:00 考试'))
  assert.ok(!prompt.includes('\u0000'))
})

test('dragged images without MIME get a supported data URL', async () => {
  const { readChatImageCompact } = imageRuntime(1000, 700)
  for (const [name, type, expected] of [
    ['screen.PNG', '', 'image/png'],
    ['screen.jpg', 'application/octet-stream', 'image/jpeg'],
    ['screen.webp', 'image/webp', 'image/webp'],
  ]) {
    const url = await readChatImageCompact(new File(['test-image'], name, { type }))
    assert.ok(url.startsWith(`data:${expected};base64,`))
  }
})

test('unsupported image types are not mislabeled as valid images', async () => {
  const image = imageRuntime(1000, 700)
  await assert.rejects(image.readChatImageCompact(new File(['text'], 'screen.png', { type: 'text/plain' })), /格式不支持/)
  await assert.rejects(image.readChatImageCompact(new File(['svg'], 'screen.svg', { type: 'image/svg+xml' })), /格式不支持/)
  assert.equal(image.decoded(), 0)
})

test('only bounded image data URLs are accepted for direct image messages', () => {
  assert.equal(isImageDataUrl('data:image/jpeg;base64,AAAA'), true)
  assert.equal(isImageDataUrl('data:image/webp;base64,AA=='), true)
  assert.equal(isImageDataUrl('https://example.com/a.png'), false)
  assert.equal(isImageDataUrl('data:text/plain;base64,AAAA'), false)
  assert.equal(isImageDataUrl('data:image/png;base64,@@@'), false)
  assert.equal(isImageDataUrl('data:image/png;base64,'), false)
  assert.equal(isImageDataUrl(`data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}`), false)
})

function imageRuntime(width, height, { oversizedPng = false, decodeError = false } = {}) {
  const draws = []
  const canvases = []
  const formats = []
  const revoked = []
  let loaded = 0
  class ImageStub {
    naturalWidth = width
    naturalHeight = height

    set src(_url) {
      loaded++
      queueMicrotask(() => decodeError ? this.onerror() : this.onload())
    }
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, Blob, FileReader: FileReaderStub, Image: ImageStub,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: (url) => revoked.push(url) },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas')
        const canvas = {
          getContext: () => ({ fillRect() {}, drawImage: (_image, ...geometry) => draws.push(geometry) }),
          toBlob(callback, type) {
            formats.push(type)
            const bytes = oversizedPng && type === 'image/png' ? Buffer.alloc(4 * 1024 * 1024 + 1) : 'test-image'
            callback(new Blob([bytes], { type }))
          },
        }
        canvases.push(canvas)
        return canvas
      },
    },
  })
  return { ...exports, draws, canvases, formats, revoked, decoded: () => loaded }
}

test('a low-byte tall PNG is split into overlapping crops in reading order', async () => {
  const image = imageRuntime(900, 4300)
  const file = new File(['image'], 'tall.png', { type: 'image/png' })
  const parts = await image.readChatImageParts(file, 2)
  assert.equal(parts.length, 2)
  assert.ok(parts.every((part) => part.startsWith('data:image/png;base64,') && isImageDataUrl(part)))
  assert.deepEqual(image.draws, [
    [0, 0, 900, 2240, 0, 0, 900, 2240],
    [0, 2060, 900, 2240, 0, 0, 900, 2240],
  ])
  assert.ok(image.canvases.every(({ width, height }) => width === 0 && height === 0))
  assert.deepEqual(image.revoked, ['blob:fixture'])
})

test('a wide screenshot splits left to right, and a single slot keeps the whole image', async () => {
  const file = new File(['image'], 'wide.png', { type: 'image/png' })
  const wide = imageRuntime(6000, 1200)
  assert.equal((await wide.readChatImageParts(file, 4)).length, 3)
  assert.deepEqual(wide.draws.map((region) => region.slice(0, 4)), [
    [0, 0, 2120, 1200], [1880, 0, 2240, 1200], [3880, 0, 2120, 1200],
  ])
  assert.ok(isImageDataUrl(await wide.readChatImageCompact(file)))
  const [last] = wide.draws.slice(-1)
  assert.deepEqual(last.slice(0, 4), [0, 0, 6000, 1200])
  assert.equal(last[6], 4096)
  assert.ok(last[6] * last[7] <= 4_000_000)
})

test('canvas pixel limits apply before encoding and oversized PNG falls back to JPEG', async () => {
  const image = imageRuntime(3600, 3600, { oversizedPng: true })
  const result = await image.readChatImageCompact(new File(['image'], 'square.png', { type: 'image/png' }))
  assert.deepEqual(image.draws, [[0, 0, 3600, 3600, 0, 0, 2000, 2000]])
  assert.deepEqual(image.formats, ['image/png', 'image/jpeg'])
  assert.ok(result.startsWith('data:image/jpeg;base64,'))
})

test('small originals are retained, including GIFs with a generic file type', async () => {
  const image = imageRuntime(1000, 700)
  const bytes = Buffer.from('image bytestream')
  const gif = new File([bytes], 'animation.gif', { type: 'application/octet-stream' })
  assert.equal(await image.readChatImageCompact(gif), `data:image/gif;base64,${bytes.toString('base64')}`)
  assert.equal(image.decoded(), 0)
  const png = new File([bytes], 'screen.png', { type: 'image/png' })
  assert.equal(await image.readChatImageCompact(png), `data:image/png;base64,${bytes.toString('base64')}`)
  assert.equal(image.draws.length, 0)
})

test('a corrupt image gets a file-specific error and releases its object URL', async () => {
  const image = imageRuntime(0, 0, { decodeError: true })
  await assert.rejects(image.readChatImageCompact(new File(['x'], 'broken.png', { type: 'image/png' })), /无法解码图片：broken\.png/)
  assert.deepEqual(image.revoked, ['blob:fixture'])
})

test('validation decodes GIFs without encoding and rejects zero-dimensional images', async () => {
  const gif = new File(['x'], 'animation.gif', { type: 'image/gif' })
  const image = imageRuntime(320, 320)
  await image.validateChatImage(gif)
  assert.equal(image.decoded(), 1)
  assert.equal(image.formats.length, 0)
  assert.deepEqual(image.revoked, ['blob:fixture'])
  const invalid = imageRuntime(0, 320)
  await assert.rejects(invalid.validateChatImage(gif), /图片尺寸无效：animation\.gif/)
  assert.deepEqual(invalid.revoked, ['blob:fixture'])
})
