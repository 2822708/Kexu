import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const code = {
  page: compile('../src/pages/AiChatPage.tsx'),
  composer: compile('../src/components/AiChatComposer.tsx'),
  uiState: compile('../src/local/ai/uiState.ts'),
  material: compile('../src/utils/chatImport.ts'),
}
const load = (source, imports = {}, globals = {}) => {
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, Error, DOMException,
    AbortController, URLSearchParams, Blob, File, ...globals,
    require(name) {
      assert.ok(name in imports, `Unexpected component dependency: ${name}`)
      return imports[name]
    } })
  return module.exports
}
const uiState = load(code.uiState)
const material = load(code.material)
const marker = (name, members = {}) => Object.assign(() => null, { stubName: name }, members)
const jsx = (type, props) => ({ type: type?.stubName ?? type, props: props ?? {} })
const textOf = (node) => node == null || typeof node === 'boolean' ? ''
  : Array.isArray(node) ? node.map(textOf).join('')
    : typeof node === 'object' ? textOf(node.props?.children) : String(node)
function flatten(node) {
  if (node == null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  const children = [node.props?.children, node.props?.extra, node.props?.title]
  if (node.type === 'List') children.push(node.props.dataSource.map(node.props.renderItem))
  return [node, ...children.flatMap(flatten)]
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// This host runs the actual Page and Composer with separate hook lifecycles.
// Only network, speech, storage and UI-library rendering are replaced boundaries.
function hookHost() {
  const slots = []
  const effects = []
  let cursor = 0
  let disposed = false
  let component
  let props
  let tree
  let dirty = true
  const changed = (old, next) => !old || !next || old.length !== next.length
    || old.some((value, index) => !Object.is(value, next[index]))
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (next) => {
        if (disposed) return
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true }
      }]
    },
    useRef(initial) { const i = cursor++; return (slots[i] ??= { current: initial }) },
    useCallback(callback, dependencies) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].dependencies, dependencies)) slots[i] = { value: callback, dependencies }
      return slots[i].value
    },
    useEffect(callback, dependencies) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].dependencies, dependencies)) effects.push(() => {
        slots[i]?.cleanup?.()
        slots[i] = { dependencies, cleanup: callback() }
      })
    },
  }
  return {
    hooks,
    init(next) { component = next },
    setProps(next) { props = next; dirty = true },
    invalidate() { dirty = true },
    dirty: () => dirty,
    tree: () => tree,
    render() {
      let rounds = 0
      while (dirty && !disposed) {
        assert.ok(++rounds < 35, 'Component hooks failed to settle')
        dirty = false
        cursor = 0
        tree = component(props)
        while (effects.length) effects.shift()()
      }
      return tree
    },
    dispose() { disposed = true; for (const slot of slots) slot?.cleanup?.() },
  }
}

const conversation = (id, scheduleId = 1, publicId = `conversation-${id}`) => ({
  id, publicId, scheduleId, title: `对话${id}`, createdAt: '2026-11-01T09:00:00', updatedAt: '2026-11-01T09:00:00',
})

async function mountChat({ local = true, conversations = [], create, recognize, honorAbort = true,
  quickImport } = {}) {
  const page = hookHost()
  const composer = hookHost()
  const state = { datasetId: 'synthetic-dataset', dataGeneration: 1,
    conversations: [...conversations], messages: [] }
  const requests = []
  const notices = []
  const draftChanges = []
  const listeners = new Set()
  let nextId = Math.max(0, ...conversations.map((item) => item.id))
  let location = { pathname: '/ai', state: quickImport ? { quickImport } : null }
  let childProps
  let failRefresh = false
  let disposed = false
  let ocrCount = 0
  const app = { activeScheduleId: 1, activeSchedule: { id: 1, name: '测试课表' },
    schedules: [{ id: 1, name: '测试课表' }, { id: 2, name: '另一课表' }],
    courses: [], exams: [], todos: [], recurringTodos: [],
    refreshSchedules: async () => {}, refreshCourses: async () => {}, refreshExams: async () => {},
    refreshTodos: async () => {}, refreshRecurring: async () => {} }
  const emit = () => { for (const listener of listeners) listener() }
  const ant = Object.fromEntries(['Alert', 'Button', 'Card', 'Checkbox', 'Input', 'List',
    'Space', 'Spin', 'Tag', 'Tooltip', 'Popconfirm'].map((name) => [name, marker(name)]))
  ant.Input.TextArea = marker('TextArea')
  ant.List.Item = marker('List.Item')
  ant.Typography = Object.fromEntries(['Title', 'Text', 'Paragraph'].map((name) => [name, marker(name)]))
  ant.message = Object.fromEntries(['error', 'warning', 'info', 'success'].map((kind) =>
    [kind, (text) => notices.push({ kind, text })]))
  const stream = (id, content, schedule, handlers, signal, intent, images = []) => {
    const response = deferred()
    const request = { id, content, schedule, signal, intent, images: [...images], response }
    requests.push(request)
    if (honorAbort) signal.addEventListener('abort', () => response.reject(new DOMException('取消', 'AbortError')), { once: true })
    return response.promise.then(() => {
      state.messages.push({ messageId: requests.length, conversationId: id, role: 'assistant', text: '合成回复', actions: [] })
      return state.messages.at(-1)
    })
  }
  const aiApi = {
    status: async () => ({ enabled: true }),
    pageConversations: async () => ({ items: [...state.conversations].reverse(), nextCursor: null }),
    pageMessages: async (id) => {
      if (failRefresh) throw new Error('模拟刷新失败')
      return { items: state.messages.filter((item) => item.conversationId === id), nextCursor: null }
    },
    createConversation: async (scheduleId) => {
      const candidate = conversation(++nextId, scheduleId)
      const row = create ? await create(candidate) : candidate
      state.conversations.push(row)
      emit()
      return row
    },
    sendMessageStream: stream,
    parseImageText: async () => { ocrCount++; return { text: recognize ? await recognize(ocrCount) : '合成截图文字' } },
  }
  const shared = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    antd: ant,
    '@ant-design/icons': new Proxy({}, { get: (_, name) => marker(String(name)) }),
    '../api': { aiApi },
    '../local/mode': { LOCAL_MODE: local },
    '../utils/chatImport': { ...material, readChatImageCompact: async () => 'data:image/png;base64,AA==' },
    '../hooks/useSpeechInput': { useSpeechConsent: () => [false, () => {}], useSpeechInput: () => ({
      recording: false, supported: false, abort() {}, stop() {}, start() {},
    }) },
    '../hooks/useMediaQuery': { useMediaQuery: () => false },
    '../local/ai/settings': { getAiSettings: () => ({ visionEnabled: true }), subscribeAiSettings: () => () => {} },
  }
  composer.init(load(code.composer, { ...shared, react: composer.hooks,
    '../utils/importFiles': { MAX_IMAGE_BYTES: 4 * 1024 * 1024,
      prepareImportFile: async (file) => ({ text: null, images: [file] }) },
  }).default)
  const eventTarget = { addEventListener() {}, removeEventListener() {} }
  page.init(load(code.page, { ...shared, react: page.hooks,
    'react-router-dom': {
      useLocation: () => location,
      useNavigate: () => (target, options = {}) => {
        location = { pathname: typeof target === 'string' ? target : target.pathname,
          state: options.state ?? null }
        page.invalidate()
      },
    },
    '../components/AiChatComposer': { __esModule: true, default: marker('AiChatComposer') },
    '../components/AiActionCard': { __esModule: true, default: marker('AiActionCard') },
    '../store/AppContext': { useApp: () => app },
    '../utils/schedule': { formatWeekInfo: () => '第1周' },
    '../local/ai': { localAiStream: stream },
    '../local/db': { readLocalState: async () => state,
      subscribeLocalChanges: (listener) => { listeners.add(listener); return () => listeners.delete(listener) } },
    '../local/ai/uiState': uiState,
    '../settings-ai.css': {},
  }, { window: eventTarget, document: { ...eventTarget, visibilityState: 'visible' },
    requestAnimationFrame: (callback) => callback() }).default)
  const pump = () => {
    if (disposed) return
    for (let rounds = 0; rounds < 30; rounds++) {
      page.render()
      const nextProps = flatten(page.tree()).find((node) => node.type === 'AiChatComposer')?.props
      assert.ok(nextProps, 'The page must render its real composer contract')
      if (nextProps !== childProps) {
        childProps = nextProps
        composer.setProps({ ...nextProps, onChange: (value) => {
          draftChanges.push(value)
          nextProps.onChange(value)
        } })
      }
      composer.render()
      if (!page.dirty() && !composer.dirty()) return
    }
    throw new Error('Parent/child state failed to settle')
  }
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((done) => setImmediate(done)); pump() } }
  const find = (host, predicate) => {
    pump()
    const node = flatten(host.tree()).find(predicate)
    assert.ok(node, 'Expected a rendered control')
    return node.props
  }
  const api = {
    state, requests, notices, draftChanges, settle, pump,
    props: () => { pump(); return childProps },
    input: () => find(composer, (node) => node.type === 'TextArea').value,
    images: () => flatten(composer.render()).filter((node) => node.type === 'Button' &&
      node.props['aria-label']?.startsWith('移除图片')).length,
    edit(value) { find(composer, (node) => node.type === 'TextArea').onChange({ target: { value } }); pump() },
    async attach() {
      find(composer, (node) => node.type === 'input' && node.props.type === 'file').onChange({
        target: { files: [new File(['image'], 'synthetic.png', { type: 'image/png' })], value: '' },
      })
      await settle()
    },
    async send() { find(composer, (node) => node.props['aria-label'] === '发送消息').onClick(); await settle() },
    async repeatedEnter() {
      const field = find(composer, (node) => node.type === 'TextArea')
      const event = { shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} }
      field.onPressEnter(event)
      field.onPressEnter(event)
      await settle()
    },
    async stop() { find(composer, (node) => node.props['aria-label'] === '停止生成').onClick(); await settle() },
    async select(id) {
      find(page, (node) => node.props['aria-label'] === `打开对话：对话${id}`).onClick()
      await settle()
    },
    async newConversation() {
      find(page, (node) => node.props['aria-label'] === '新建对话').onClick()
      await settle()
    },
    async schedule(id) {
      app.activeScheduleId = id
      app.activeSchedule = app.schedules.find((item) => item.id === id)
      page.invalidate()
      await settle()
    },
    async replace({ generation = state.dataGeneration, rows = state.conversations } = {}) {
      state.dataGeneration = generation
      state.conversations = rows
      emit()
      await settle()
    },
    failRefresh() { failRefresh = true },
    ocrCount: () => ocrCount,
    dispose() { disposed = true; page.dispose(); composer.dispose() },
  }
  pump()
  await settle()
  return api
}

test('the first automatic dialogue keeps image and text on failure and retries the same complete payload', async () => {
  const h = await mountChat()
  h.edit('首条图片消息')
  await h.attach()
  const scope = h.props().scopeKey
  await h.send()
  assert.equal(h.requests.length, 1)
  assert.equal(h.props().scopeKey, scope)
  assert.equal(h.images(), 1)
  h.requests[0].response.reject(new Error('模拟401'))
  await h.settle()
  assert.equal(h.input(), '首条图片消息')
  assert.equal(h.images(), 1)
  await h.send()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].id, h.requests[0].id)
  assert.equal(h.requests[1].content, h.requests[0].content)
  assert.deepEqual(h.requests[1].images, h.requests[0].images)
  h.requests[1].response.resolve()
  await h.settle()
  assert.equal(h.input(), '')
  assert.equal(h.images(), 0)
  assert.equal(h.state.conversations.length, 1)
  h.dispose()
})

test('an existing dialogue failure retains attachments and successful resend clears them once', async () => {
  const h = await mountChat({ conversations: [conversation(1)] })
  h.edit('已有对话草稿')
  await h.attach()
  await h.send()
  h.requests[0].response.reject(new Error('模拟断网'))
  await h.settle()
  assert.equal(h.input(), '已有对话草稿')
  assert.equal(h.images(), 1)
  await h.send()
  h.requests[1].response.resolve()
  await h.settle()
  assert.equal(h.input(), '')
  assert.equal(h.images(), 0)
  assert.equal(h.props().sending, false)
  h.dispose()
})

test('a failed initial dialogue creation preserves its complete draft and returns to an idle composer', async () => {
  const h = await mountChat({ create: async () => { throw new Error('创建失败') } })
  h.edit('不能丢失的草稿')
  await h.attach()
  await h.send()
  assert.equal(h.requests.length, 0)
  assert.equal(h.input(), '不能丢失的草稿')
  assert.equal(h.images(), 1)
  assert.equal(h.props().sending, false)
  h.dispose()
})

test('stopping a request leaves the original text and images available for retry', async () => {
  const h = await mountChat({ conversations: [conversation(1)] })
  h.edit('中途停止')
  await h.attach()
  await h.send()
  await h.stop()
  assert.equal(h.requests[0].signal.aborted, true)
  assert.equal(h.input(), '中途停止')
  assert.equal(h.images(), 1)
  assert.equal(h.props().sending, false)
  h.dispose()
})

test('a late successful boundary that ignores abort cannot leave the stream stuck in stop mode', async () => {
  const h = await mountChat({ conversations: [conversation(1)], honorAbort: false })
  h.edit('取消后迟到')
  await h.attach()
  await h.send()
  await h.stop()
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.input(), '取消后迟到')
  assert.equal(h.images(), 1)
  assert.equal(h.props().sending, false)
  h.dispose()
})

test('a successful old message does not clear text edited while it was running', async () => {
  const h = await mountChat({ conversations: [conversation(1)] })
  h.edit('正在发送')
  await h.attach()
  await h.send()
  h.edit('下一条的新草稿')
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.input(), '下一条的新草稿')
  assert.equal(h.images(), 0)
  h.dispose()
})

test('manual conversation switching discards old attachments and ignores a late failure', async () => {
  const h = await mountChat({ conversations: [conversation(1), conversation(2)], honorAbort: false })
  h.edit('旧对话材料')
  await h.attach()
  await h.send()
  const oldScope = h.props().scopeKey
  await h.select(1)
  assert.notEqual(h.props().scopeKey, oldScope)
  assert.equal(h.images(), 0)
  h.edit('另一对话的新材料')
  h.requests[0].response.reject(new Error('旧请求迟到'))
  await h.settle()
  assert.equal(h.input(), '另一对话的新材料')
  assert.equal(h.images(), 0)
  h.dispose()
})

test('manual new-dialogue creation isolates its draft and an old finally cannot clear a newer stream', async () => {
  const h = await mountChat({ conversations: [conversation(1)], honorAbort: false })
  h.edit('旧请求')
  await h.attach()
  await h.send()
  await h.newConversation()
  assert.equal(h.images(), 0)
  h.edit('新对话请求')
  await h.send()
  assert.equal(h.requests.length, 2)
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.props().sending, true)
  assert.equal(h.input(), '新对话请求')
  h.requests[1].response.resolve()
  await h.settle()
  assert.equal(h.props().sending, false)
  assert.equal(h.input(), '')
  h.dispose()
})

test('switching schedules invalidates the draft and prevents late creation from selecting the old workspace', async () => {
  const creation = deferred()
  const h = await mountChat({ conversations: [conversation(1)], create: () => creation.promise })
  h.edit('旧课表草稿')
  await h.attach()
  await h.newConversation()
  const createdScope = h.props().scopeKey
  await h.schedule(2)
  assert.notEqual(h.props().scopeKey, createdScope)
  creation.resolve(conversation(2, 1))
  await h.settle()
  assert.equal(h.images(), 0)
  assert.equal(h.input(), '')
  assert.equal(h.props().disabled, true)
  assert.equal(h.props().sending, false)
  h.dispose()
})

test('restoring the dataset invalidates draft images even when numeric conversation IDs stay the same', async () => {
  const h = await mountChat({ conversations: [conversation(1)], honorAbort: false })
  h.edit('旧数据集草稿')
  await h.attach()
  await h.send()
  const oldScope = h.props().scopeKey
  await h.replace({ generation: 2, rows: [conversation(1, 1, 'restored-conversation')] })
  assert.notEqual(h.props().scopeKey, oldScope)
  assert.equal(h.images(), 0)
  h.edit('恢复后的新草稿')
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.input(), '恢复后的新草稿')
  assert.equal(h.images(), 0)
  h.dispose()
})

test('replacing only the selected public ID also invalidates old attachments without a generation change', async () => {
  const h = await mountChat({ conversations: [conversation(1)] })
  h.edit('同数字ID的旧材料')
  await h.attach()
  const oldScope = h.props().scopeKey
  await h.replace({ rows: [conversation(1, 1, 'another-public-id')] })
  assert.notEqual(h.props().scopeKey, oldScope)
  assert.equal(h.images(), 0)
  assert.equal(h.input(), '')
  h.dispose()
})

test('an unmounted composer ignores its late success instead of clearing the external draft', async () => {
  const h = await mountChat({ conversations: [conversation(1)], honorAbort: false })
  h.edit('卸载前的材料')
  await h.attach()
  await h.send()
  const notices = h.notices.length
  const writes = h.draftChanges.length
  h.dispose()
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.notices.length, notices)
  assert.equal(h.draftChanges.length, writes)
})

test('REST retry prepares the same OCR payload without repeatedly appending it to the user draft', async () => {
  const h = await mountChat({ local: false, conversations: [conversation(1)] })
  h.edit('用户原文字')
  await h.attach()
  await h.send()
  h.requests[0].response.reject(new Error('REST发送失败'))
  await h.settle()
  assert.equal(h.input(), '用户原文字')
  assert.equal(h.images(), 1)
  await h.send()
  assert.equal(h.requests[1].content, h.requests[0].content)
  assert.deepEqual(h.requests[1].images, [])
  assert.equal(h.ocrCount(), 2)
  h.requests[1].response.resolve()
  await h.settle()
  assert.equal(h.input(), '')
  assert.equal(h.images(), 0)
  h.dispose()
})

test('OCR preparation failure leaves text and images untouched and makes no chat request', async () => {
  const h = await mountChat({ local: false, conversations: [conversation(1)],
    recognize: async () => { throw new Error('OCR失败') } })
  h.edit('原文字')
  await h.attach()
  await h.send()
  assert.equal(h.requests.length, 0)
  assert.equal(h.input(), '原文字')
  assert.equal(h.images(), 1)
  h.dispose()
})

test('a saved successful reply is acknowledged even when the later UI refresh fails', async () => {
  const h = await mountChat({ conversations: [conversation(1)] })
  h.edit('回复已保存')
  await h.attach()
  await h.send()
  h.failRefresh()
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.input(), '')
  assert.equal(h.images(), 0)
  assert.ok(h.notices.some((notice) => notice.kind === 'warning' && notice.text.includes('回复已保存')))
  h.dispose()
})

test('import intent survives a failed image message and clears only after a successful handoff', async () => {
  const h = await mountChat({ conversations: [conversation(1)], quickImport: {
    conversationId: 1, conversationPublicId: 'conversation-1', scheduleId: 1,
    prompt: '用户转交的导入材料', intent: 'IMPORT_EVENTS',
    images: [{ name: '导入图片.png', dataUrl: 'data:image/png;base64,AA==' }],
  } })
  assert.equal(h.images(), 1)
  await h.send()
  assert.equal(h.requests[0].intent, 'IMPORT_EVENTS')
  h.requests[0].response.reject(new Error('模拟导入失败'))
  await h.settle()
  await h.send()
  assert.equal(h.requests[1].intent, 'IMPORT_EVENTS')
  h.requests[1].response.resolve()
  await h.settle()
  h.edit('普通追问')
  await h.send()
  assert.equal(h.requests[2].intent, undefined)
  h.requests[2].response.resolve()
  await h.settle()
  h.dispose()
})

test('an older automatic create finally cannot mark a newer manual create as idle', async () => {
  const first = deferred()
  const second = deferred()
  let count = 0
  const h = await mountChat({ create: () => (++count === 1 ? first.promise : second.promise) })
  h.edit('自动创建中的消息')
  await h.attach()
  await h.send()
  await h.newConversation()
  assert.equal(h.props().sending, true)
  first.resolve(conversation(1))
  await h.settle()
  assert.equal(h.props().sending, true)
  second.resolve(conversation(2))
  await h.settle()
  assert.equal(h.props().sending, false)
  assert.equal(h.requests.length, 0)
  assert.equal(h.images(), 0)
  h.dispose()
})

test('rapid repeated Enter starts one automatic dialogue and one image request', async () => {
  const h = await mountChat()
  h.edit('不可重复发送')
  await h.attach()
  await h.repeatedEnter()
  assert.equal(h.requests.length, 1)
  assert.equal(h.state.conversations.length, 1)
  assert.equal(h.images(), 1)
  h.requests[0].response.resolve()
  await h.settle()
  assert.equal(h.input(), '')
  assert.equal(h.images(), 0)
  h.dispose()
})
