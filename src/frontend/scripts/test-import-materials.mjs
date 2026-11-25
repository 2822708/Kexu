import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace('import.meta.env.BASE_URL', "'/'"), {
  fileName: path,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText

const importModule = { exports: {} }
vm.runInNewContext(compile('../src/utils/importFiles.ts'), {
  module: importModule,
  exports: importModule.exports,
  Error,
})
const importFiles = importModule.exports
const widgetCode = compile('../src/components/QuickImportWidget.tsx')
const element = (type, props) => ({ type, props: props ?? {} })
const textOf = (node) => node == null || typeof node === 'boolean' ? ''
  : Array.isArray(node) ? node.map(textOf).join('')
    : typeof node === 'object' ? textOf(node.props?.children) : String(node)

function flatten(node) {
  if (node == null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node, ...flatten(node.props?.children), ...flatten(node.props?.footer)]
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

// Drive the real component's rendered callbacks with a deterministic hook host.
// File extraction and OCR are external boundaries; no browser storage or network is used.
function mountWidget({ material, recognize, local = true, createConversation, validateImage = async () => {} } = {}) {
  const slots = []
  const effects = []
  const navigations = []
  let cursor = 0
  let dirty = true
  let tree
  let writes = 0
  let scope = 1
  let disposed = false
  const speech = { recording: false, start() {}, stop() {}, abort() {}, supported: false }
  const changed = (previous, next) => !previous || previous.length !== next?.length
    || previous.some((value, index) => !Object.is(value, next[index]))
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (next) => {
        writes++
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true }
      }]
    },
    useRef(initial) {
      const index = cursor++
      return (slots[index] ??= { current: initial })
    },
    useMemo(factory, dependencies) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        slots[index] = { value: factory(), dependencies }
      }
      return slots[index].value
    },
    useEffect(callback, dependencies) {
      const index = cursor++
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        effects.push(() => {
          slots[index]?.cleanup?.()
          slots[index] = { dependencies, cleanup: callback() }
        })
      }
    },
  }
  const parseImageText = async (...args) => ({ text: await recognize(...args) })
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    antd: {
      Alert: 'Alert', Button: 'Button', Checkbox: 'Checkbox', Collapse: 'Collapse',
      FloatButton: 'FloatButton', Input: { TextArea: 'TextArea' }, Modal: 'Modal',
      Space: 'Space', Typography: { Paragraph: 'Paragraph', Text: 'Text' },
      Upload: { Dragger: 'Dragger', LIST_IGNORE: Symbol('ignore') },
    },
    '@ant-design/icons': new Proxy({}, { get: (_, name) => String(name) }),
    'react-router-dom': { useNavigate: () => (...args) => navigations.push(args) },
    '../api': {
      aiApi: {
        parseImageText,
        createConversation: createConversation ?? (async () => ({ id: 7, publicId: 'synthetic-conversation' })),
      },
    },
    '../store/AppContext': {
      useApp: () => ({ activeScheduleId: scope, activeSchedule: { id: scope, name: `测试课表${scope}` } }),
    },
    '../hooks/useSpeechInput': {
      useSpeechConsent: () => [false, () => {}], useSpeechInput: () => speech,
    },
    '../utils/importFiles': {
      ...importFiles,
      prepareImportFile: async (file) => typeof material === 'function' ? material(file) : material,
    },
    '../utils/chatImport': {
      readChatImageCompact: async () => 'data:image/png;base64,AA==',
      validateChatImage: validateImage,
    },
    '../local/mode': { LOCAL_MODE: local },
    '../local/ai': { localAiApi: { parseImageText } },
  }
  const componentModule = { exports: {} }
  vm.runInNewContext(widgetCode, {
    module: componentModule,
    exports: componentModule.exports,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected component dependency: ${name}`)
      return imports[name]
    },
    AbortController,
    Error,
    URL: { createObjectURL: () => 'blob:synthetic-preview', revokeObjectURL() {} },
  })
  const render = () => {
    if (disposed) throw new Error('Test attempted to render an unmounted component')
    let turns = 0
    while (dirty) {
      if (++turns > 20) throw new Error('Hook host did not settle')
      dirty = false
      cursor = 0
      tree = componentModule.exports.default()
      while (effects.length) effects.shift()()
    }
    return tree
  }
  const find = (type, label) => {
    render()
    const node = flatten(tree).find((item) => item.type === type && (label == null || textOf(item) === label))
    assert.ok(node, `Missing rendered ${type}: ${label ?? ''}`)
    return node.props
  }
  const api = {
    render,
    find,
    navigations,
    text: () => find('TextArea').value,
    source: () => flatten(render()).filter((node) => node.type === 'Text').map(textOf).join('\n'),
    hasImages: () => flatten(render()).some((node) => node.type === 'img'),
    error: () => flatten(render()).find((node) => node.type === 'Alert' && node.props.type === 'error')?.props.message,
    edit(value) { find('TextArea').onChange({ target: { value } }); render() },
    async upload(file) {
      find('Dragger').beforeUpload(file)
      await new Promise((resolve) => setImmediate(resolve))
      render()
    },
    async transcribe() { const result = find('Button', '先识别文字（可编辑）').onClick(); render(); await result; render() },
    startTranscribing() { const result = find('Button', '先识别文字（可编辑）').onClick(); render(); return result },
    close() { find('Modal').onCancel(); render() },
    setScope(next) { scope = next; dirty = true; render() },
    dispose() { disposed = true; for (const slot of slots) slot?.cleanup?.() },
    writes: () => writes,
    async forward() { const result = find('Modal').footer.props.onClick(); render(); await result; render() },
  }
  render()
  find('FloatButton').onClick()
  render()
  return api
}

const image = (name = '扫描页.jpg') => new File(['synthetic-image'], name, { type: 'image/jpeg' })
const pdf = () => new File(['synthetic-pdf'], '混合材料.pdf', { type: 'application/pdf' })

test('mixed PDF OCR fills the original page position and preserves edits', async () => {
  const original = '第 1 页：周一数学\n\n第 2 页：\n【扫描页待识别：扫描页.jpg】\n\n第 3 页：周三物理'
  const widget = mountWidget({ material: { text: original, images: [image()] }, recognize: async () => '周二英语' })
  await widget.upload(pdf())
  widget.edit(`${original}\n用户补充：带课本`)
  assert.equal(widget.hasImages(), true)
  await widget.transcribe()
  assert.equal(widget.text(), '第 1 页：周一数学\n\n第 2 页：\n周二英语\n\n第 3 页：周三物理\n用户补充：带课本')
  assert.equal(widget.hasImages(), false)
  assert.equal(widget.navigations.length, 0)
  widget.dispose()
})

test('a damaged replacement file leaves the previous draft and pages available', async () => {
  const widget = mountWidget({
    material(file) {
      if (file.name === '损坏.pdf') throw new Error('无法读取该 PDF')
      return { text: '原 PDF 的文字页', images: [image()] }
    },
    validateImage: async () => { throw new Error('无法解码图片：损坏.png') },
    recognize: async () => '原 PDF 扫描页识别结果',
  })
  await widget.upload(pdf())
  await widget.upload(new File(['broken'], '损坏.pdf', { type: 'application/pdf' }))
  assert.equal(widget.text(), '原 PDF 的文字页')
  assert.equal(widget.hasImages(), true)
  assert.match(widget.error(), /无法读取该 PDF/)
  await widget.upload(new File(['broken'], '损坏.png', { type: 'image/png' }))
  assert.equal(widget.text(), '原 PDF 的文字页')
  assert.equal(widget.hasImages(), true)
  assert.match(widget.error(), /无法解码图片/)
  await widget.transcribe()
  assert.equal(widget.text(), '原 PDF 的文字页\n\n原 PDF 扫描页识别结果')
  widget.dispose()
})

test('image-only OCR produces editable text without an empty material prefix', async () => {
  const widget = mountWidget({ recognize: async () => '  截图中的安排  ' })
  await widget.upload(image())
  await widget.transcribe()
  assert.equal(widget.text(), '截图中的安排')
  assert.equal(widget.hasImages(), false)
  widget.dispose()
})

test('the combined size limit is atomic and retains the original text and image', async () => {
  const original = '原'.repeat(importFiles.MAX_IMPORT_TEXT_CHARS - 4)
  const widget = mountWidget({ material: { text: original, images: [image()] }, recognize: async () => '识别结果太长' })
  await widget.upload(pdf())
  await widget.transcribe()
  assert.equal(widget.text(), original)
  assert.equal(widget.hasImages(), true)
  assert.match(widget.error(), /合并后的导入文字超过18000|合并后的导入文字超过 18000/)
  assert.match(widget.error(), /原文字和图片已保留/)
  widget.dispose()
})

test('a later page failing OCR keeps every page and all original material for retry', async () => {
  let page = 0
  const widget = mountWidget({
    material: { text: '已有文字', images: [image('1.jpg'), image('2.jpg')] },
    recognize: async () => { if (++page === 2) throw new Error('模拟第二页失败'); return '第一页识别结果' },
  })
  await widget.upload(pdf())
  await widget.transcribe()
  assert.equal(widget.text(), '已有文字')
  assert.equal(widget.hasImages(), true)
  assert.match(widget.source(), /共\s*2\s*页/)
  assert.match(widget.error(), /模拟第二页失败/)
  widget.dispose()
})

test('closing during OCR ignores its late result while preserving the closed draft', async () => {
  const response = deferred()
  const widget = mountWidget({ material: { text: '关闭前文字', images: [image()] }, recognize: () => response.promise })
  await widget.upload(pdf())
  const pending = widget.startTranscribing()
  await Promise.resolve()
  widget.close()
  response.resolve('迟到的识别文字')
  await pending
  widget.render()
  assert.equal(widget.find('Modal').open, false)
  assert.equal(widget.text(), '关闭前文字')
  assert.equal(widget.hasImages(), true)
  assert.equal(widget.error(), undefined)
  widget.dispose()
})

test('changing the timetable prevents an old OCR result from entering the new scope', async () => {
  const response = deferred()
  const widget = mountWidget({ material: { text: '原工作区文字', images: [image()] }, recognize: () => response.promise })
  await widget.upload(pdf())
  const pending = widget.startTranscribing()
  await Promise.resolve()
  widget.setScope(2)
  response.resolve('旧课表识别结果')
  await pending
  widget.render()
  assert.equal(widget.text(), '原工作区文字')
  assert.equal(widget.hasImages(), false)
  assert.match(widget.error(), /课表已切换/)
  widget.dispose()
})

test('unmounting during OCR does not write any late state', async () => {
  const response = deferred()
  const widget = mountWidget({ material: { text: '原文字', images: [image()] }, recognize: () => response.promise })
  await widget.upload(pdf())
  const pending = widget.startTranscribing()
  await Promise.resolve()
  widget.dispose()
  const writes = widget.writes()
  response.resolve('卸载后的识别结果')
  await pending
  assert.equal(widget.writes(), writes)
})

test('server OCR handoff includes both text sources and retains the import intent', async () => {
  const source = '第 1 页：\n【扫描页待识别：扫描页.jpg】\n\n第 2 页：本地文字页'
  const widget = mountWidget({ local: false, material: { text: source, images: [image()] }, recognize: async () => '扫描文字页' })
  await widget.upload(pdf())
  await widget.forward()
  assert.equal(widget.navigations.length, 1)
  const [path, options] = widget.navigations[0]
  assert.equal(path, '/ai')
  assert.equal(options.state.quickImport.intent, 'IMPORT_EVENTS')
  assert.ok(options.state.quickImport.prompt.includes('第 1 页：\n扫描文字页\n\n第 2 页：本地文字页'))
  assert.equal(options.state.quickImport.images.length, 0)
  widget.dispose()
})

test('local handoff preserves the scan marker and attaches the original page by name', async () => {
  const marker = '【扫描页待识别：扫描页.jpg】'
  const widget = mountWidget({ material: { text: `${marker}\n\n第 2 页：周二英语`, images: [image()] } })
  await widget.upload(pdf())
  await widget.forward()
  const { quickImport } = widget.navigations[0][1].state
  assert.ok(quickImport.prompt.includes(marker))
  assert.equal(quickImport.images[0].name, '扫描页.jpg')
  widget.dispose()
})

test('a failed conversation handoff retains the original server OCR draft and image', async () => {
  const widget = mountWidget({
    local: false,
    material: { text: '本地文字页', images: [image()] },
    recognize: async () => '扫描文字页',
    createConversation: async () => { throw new Error('会话创建失败') },
  })
  await widget.upload(pdf())
  await widget.forward()
  assert.equal(widget.text(), '本地文字页')
  assert.equal(widget.hasImages(), true)
  assert.equal(widget.navigations.length, 0)
  assert.match(widget.error(), /会话创建失败/)
  widget.dispose()
})

test('server handoff rejects an oversized merge without navigating or discarding materials', async () => {
  const original = '原'.repeat(importFiles.MAX_IMPORT_TEXT_CHARS - 4)
  const widget = mountWidget({ local: false, material: { text: original, images: [image()] }, recognize: async () => '扫描文字页过长' })
  await widget.upload(pdf())
  await widget.forward()
  assert.equal(widget.navigations.length, 0)
  assert.equal(widget.text(), original)
  assert.equal(widget.hasImages(), true)
  assert.match(widget.error(), /原文字和图片已保留/)
  widget.dispose()
})

test('a merge at the exact text limit succeeds without truncating any material', () => {
  const existing = '原'.repeat(importFiles.MAX_IMPORT_TEXT_CHARS - 4)
  assert.equal(importFiles.mergeImportText(existing, '新文'), `${existing}\n\n新文`)
  assert.equal(importFiles.mergeImportText(existing, '新文').length, importFiles.MAX_IMPORT_TEXT_CHARS)
})
