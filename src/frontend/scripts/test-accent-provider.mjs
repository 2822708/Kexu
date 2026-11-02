import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React.act ? React : require('react-dom/test-utils')

function loadTs(path, requireOverride) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const moduleObject = { exports: {} }
  new Function('exports', 'module', 'require', compiled)(moduleObject.exports, moduleObject, requireOverride)
  return moduleObject.exports
}

const accent = loadTs('../src/accent.ts', require)
const context = loadTs('../src/store/AccentContext.tsx', (id) => {
  if (id === '../accent') return accent
  return require(id)
})

test('主题色偏好写入 CSS 变量与 localStorage，并可恢复默认', async () => {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><head></head><body></body></html>', {
    url: 'https://kexu.example.test/',
  })
  const previous = {}
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'DOMException', 'IS_REACT_ACT_ENVIRONMENT']) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key)
  }
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true })
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true })
  Object.defineProperty(globalThis, 'DOMException', { value: dom.window.DOMException, configurable: true })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })

  let api = null
  function Probe() {
    api = context.useAccent()
    return null
  }

  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(React.createElement(context.AccentProvider, null, React.createElement(Probe)))
    })

    assert.ok(api, 'Probe 应拿到 context')
    assert.equal(dom.window.localStorage.getItem('timetable.accent'), null)

    await act(async () => {
      api.setChoice({ id: 'pine', hue: 158, chroma: 0.09 })
    })

    const style = dom.window.document.getElementById('kexu-accent-style')
    assert.ok(style, '应注入主题色样式')
    assert.match(style.textContent, /:root\[data-theme='light'\]\{--accent:#[0-9a-f]{6}/)
    assert.match(style.textContent, /:root\[data-theme='dark'\]\{--accent:#[0-9a-f]{6}/)
    assert.equal(
      dom.window.localStorage.getItem('timetable.accent'),
      JSON.stringify({ id: 'pine', hue: 158, chroma: 0.09 }),
    )
    assert.equal(api.palette.light.base, accent.buildPalette({ id: 'pine', hue: 158, chroma: 0.09 }).light.base)

    await act(async () => {
      api.setChoice(null)
    })

    assert.equal(dom.window.document.getElementById('kexu-accent-style'), null)
    assert.equal(dom.window.localStorage.getItem('timetable.accent'), null)
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
