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
const { appendChatText, chatMaterialText, readChatImage, MAX_CHAT_CHARS } = exports

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
  for (const [name, type, expected] of [
    ['screen.PNG', '', 'image/png'],
    ['screen.jpg', 'application/octet-stream', 'image/jpeg'],
    ['screen.webp', 'image/webp', 'image/webp'],
  ]) {
    const url = await readChatImage(new File(['test-image'], name, { type }))
    assert.ok(url.startsWith(`data:${expected};base64,`))
  }
})

test('unsupported image types are not mislabeled as valid images', async () => {
  await assert.rejects(readChatImage(new File(['text'], 'screen.png', { type: 'text/plain' })), /格式不支持/)
  await assert.rejects(readChatImage(new File(['svg'], 'screen.svg', { type: 'image/svg+xml' })), /格式不支持/)
})
