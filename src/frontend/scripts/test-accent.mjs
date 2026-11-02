import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/accent.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const moduleObject = { exports: {} }
new Function('exports', 'module', compiled)(moduleObject.exports, moduleObject)
const accent = moduleObject.exports

test('默认主题色保持既有主色', () => {
  const preset = accent.ACCENT_PRESETS.find((item) => item.id === 'default')
  assert.equal(accent.presetSwatch(preset), '#167d9a')
})

test('任意色相下浅色主题的白字对比度不低于 4.5:1', () => {
  for (let hue = 0; hue < 360; hue += 10) {
    for (const chroma of [0.03, 0.09, 0.13]) {
      const palette = accent.buildPalette({ id: 'custom', hue, chroma })
      const ratio = accent.contrastRatio(palette.light.base, '#ffffff')
      assert.ok(
        ratio >= 4.5,
        `hue ${hue} chroma ${chroma} 白字对比度 ${ratio.toFixed(2)} 低于 4.5`,
      )
    }
  }
})

test('浅底强调文字与深色主题主色均可读', () => {
  for (let hue = 0; hue < 360; hue += 10) {
    const palette = accent.buildPalette({ id: 'custom', hue, chroma: 0.09 })
    const onSoft = accent.contrastRatio(palette.light.ink, palette.light.soft)
    assert.ok(onSoft >= 4.5, `hue ${hue} 浅底文字对比度 ${onSoft.toFixed(2)} 低于 4.5`)
    const onDark = accent.contrastRatio(palette.dark.base, '#172a35')
    assert.ok(onDark >= 4.5, `hue ${hue} 深色主色对比度 ${onDark.toFixed(2)} 低于 4.5`)
  }
})

test('预设主题色同样满足对比度要求', () => {
  for (const preset of accent.ACCENT_PRESETS) {
    const palette = accent.buildPalette(preset)
    assert.ok(accent.contrastRatio(palette.light.base, '#ffffff') >= 4.5, preset.label)
    assert.ok(accent.contrastRatio(palette.light.ink, palette.light.soft) >= 4.5, preset.label)
    assert.ok(accent.contrastRatio(palette.dark.base, '#172a35') >= 4.5, preset.label)
  }
})

test('偏好解析拒绝损坏的数据', () => {
  assert.equal(accent.parseChoice(null), null)
  assert.equal(accent.parseChoice('not json'), null)
  assert.equal(accent.parseChoice('{"id":"x","hue":999,"chroma":0.09}'), null)
  assert.equal(accent.parseChoice('{"id":"x","hue":120,"chroma":-1}'), null)
  assert.deepEqual(accent.parseChoice('{"id":"custom","hue":120,"chroma":0.09}'), {
    id: 'custom',
    hue: 120,
    chroma: 0.09,
  })
})
