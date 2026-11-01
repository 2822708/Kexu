import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/pages/TodosPage.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText

function harness({ url = '/tasks?view=all', entries = [] } = {}) {
  const history = [new URL(url, 'https://kexu.example.test')]
  let cursor = 0
  const marker = (name, extras = {}) => Object.assign(() => null, { stubName: name }, extras)
  const ant = Object.fromEntries([
    'Button', 'Alert', 'Card', 'Checkbox', 'DatePicker', 'Empty', 'Input', 'Modal',
    'Popconfirm', 'Segmented', 'Space', 'Spin', 'Tabs', 'Tag', 'Tooltip',
  ].map((name) => [name, marker(name)]))
  ant.Typography = Object.fromEntries(['Title', 'Text', 'Paragraph'].map((name) => [name, marker(name)]))
  ant.Form = marker('Form', { useForm: () => [{}], Item: marker('Form.Item') })
  ant.List = marker('List', { Item: marker('List.Item', { Meta: marker('List.Item.Meta') }) })
  ant.message = { error() {}, success() {}, info() {} }
  const workspace = { date: '2026-10-31', state: { dayEntries: entries, todos: [] } }
  const app = {
    todos: [
      { id: 1, title: '普通待办', ddl: '2026-11-05T12:00:00', completed: false },
      { id: 2, title: '已完成待办', ddl: '2026-10-31T12:00:00', completed: true },
    ],
    recurringTodos: [],
  }
  const navigate = (target) => {
    const next = typeof target === 'string' ? target
      : `${target.pathname ?? history[cursor].pathname}${target.search ?? ''}${target.hash ?? ''}`
    history.splice(cursor + 1)
    history.push(new URL(next, history[cursor]))
    cursor++
  }
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect() {},
    useMemo: (create) => create(),
  }
  const jsx = (type, props) => ({ type: type?.stubName ?? type, props: props ?? {} })
  const modules = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-router-dom': {
      useNavigate: () => navigate,
      useLocation: () => history[cursor],
    },
    antd: ant,
    '@ant-design/icons': new Proxy({}, { get: (_, name) => marker(`Icon.${name}`) }),
    '../components/RecurringTodoPanel': { default: marker('RecurringTodoPanel') },
    '../api': {},
    '../store/AppContext': { useApp: () => app },
    '../utils/schedule': { dayjs, formatCountdown: () => '稍后截止' },
    '../local/mode': { LOCAL_MODE: true },
    '../hooks/useDailyWorkspace': { useDailyWorkspace: () => ({ workspace, refresh: async () => workspace }) },
    '../local/daily/commands': { dailyApi: {} },
    '../local/domain': { nowLocalDateTime: () => '2026-10-31T09:00:00' },
    '../daily-pages.css': {},
  }
  const exports = {}
  class FixedDate extends Date { static now() { return new Date('2026-10-31T09:00:00').valueOf() } }
  vm.runInNewContext(compiled, {
    exports, URLSearchParams, Date: FixedDate,
    require: (name) => {
      if (!(name in modules)) throw new Error(`Unexpected test dependency: ${name}`)
      return modules[name]
    },
  })
  const expand = (node) => {
    if (Array.isArray(node)) return node.flatMap((child) => [].concat(expand(child)))
    if (node == null || typeof node === 'boolean') return []
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    const props = node.props ?? {}
    const children = [props.children, props.title, props.description, props.actions]
    if (node.type === 'List') children.push(props.dataSource.map(props.renderItem))
    return { ...node, children: children.flatMap((child) => [].concat(expand(child))) }
  }
  const render = () => expand(exports.default({ embedded: true }))
  const all = (node) => typeof node === 'object' && node !== null
    ? [node, ...(node.children ?? []).flatMap(all)] : []
  const text = (node) => typeof node === 'object' && node !== null
    ? (node.children ?? []).map(text).join('') : String(node ?? '')
  return {
    render, all, text,
    current: () => history[cursor],
    changeFilter: (value) => all(render()).find((node) => node.type === 'Segmented').props.onChange(value),
    filter: () => all(render()).find((node) => node.type === 'Segmented').props.value,
    back: () => { if (cursor) cursor-- },
    forward: () => { if (cursor + 1 < history.length) cursor++ },
    navigate,
  }
}

const task = (id, plannedDate) => ({
  id, publicId: `day-${id}`, kind: 'dayTask', title: `日任务${id}`, plannedDate, completed: false,
})

test('task filter comes from the URL, defaults invalid values, and filters the actual list', () => {
  const completed = harness({ url: '/tasks?view=all&taskFilter=completed' })
  assert.equal(completed.filter(), 'completed')
  assert.match(completed.text(completed.render()), /已完成待办/)
  assert.doesNotMatch(completed.text(completed.render()), /普通待办/)
  const invalid = harness({ url: '/tasks?view=all&taskFilter=unknown' })
  assert.equal(invalid.filter(), 'active')
  assert.match(invalid.text(invalid.render()), /普通待办/)
  assert.doesNotMatch(invalid.text(invalid.render()), /已完成待办/)
})

test('changing filters preserves the route, date, unrelated query and hash and follows history', () => {
  const h = harness({ url: '/tasks?view=all&date=2026-11-02&source=test&taskFilter=completed#task-list' })
  h.changeFilter('all')
  assert.equal(h.current().pathname, '/tasks')
  assert.equal(h.current().searchParams.get('view'), 'all')
  assert.equal(h.current().searchParams.get('date'), '2026-11-02')
  assert.equal(h.current().searchParams.get('source'), 'test')
  assert.equal(h.current().hash, '#task-list')
  assert.equal(h.filter(), 'all')
  h.back()
  assert.equal(h.filter(), 'completed')
  h.forward()
  assert.equal(h.filter(), 'all')
  const refreshed = harness({ url: h.current().href })
  assert.equal(refreshed.filter(), 'all')
})

test('view changes retain the selected filter rather than resetting component state', () => {
  const h = harness({ url: '/tasks?view=all&taskFilter=completed&date=2026-10-31' })
  h.navigate('/tasks?view=today&taskFilter=completed&date=2026-10-31')
  h.navigate('/tasks?view=all&taskFilter=completed&date=2026-10-31')
  assert.equal(h.filter(), 'completed')
})

test('opening a planned task keeps the list filter and unrelated navigation context', () => {
  const h = harness({
    url: '/tasks?view=all&taskFilter=all&source=test#task-list',
    entries: [task(1, '2026-11-02')],
  })
  h.all(h.render()).find((node) => node.props?.['aria-label'] === '打开任务 日任务1').props.onClick()
  assert.equal(h.current().searchParams.get('view'), 'today')
  assert.equal(h.current().searchParams.get('date'), '2026-11-02')
  assert.equal(h.current().searchParams.get('taskFilter'), 'all')
  assert.equal(h.current().searchParams.get('source'), 'test')
  assert.equal(h.current().hash, '#task-list')
  h.back()
  assert.equal(h.filter(), 'all')
})

test('a shared day-task date appears once in its group while mixed dates remain on each row', () => {
  const shared = harness({ entries: [task(1, '2026-11-02'), task(2, '2026-11-02')] })
  const sharedText = shared.text(shared.render())
  assert.equal(sharedText.match(/2026-11-02/g)?.length, 1)
  assert.match(sharedText, /日任务计划 2026-11-02/)
  const mixed = harness({ entries: [task(1, '2026-11-02'), task(2, '2026-11-03')] })
  const mixedText = mixed.text(mixed.render())
  assert.match(mixedText, /计划日 2026-11-02/)
  assert.match(mixedText, /计划日 2026-11-03/)
  assert.match(mixedText, /截止 2026-11-05 12:00/)
})

test('notification limits remain accessible in a native collapsed disclosure', () => {
  const h = harness()
  const disclosure = h.all(h.render()).find((node) => node.type === 'details')
  assert.ok(disclosure)
  assert.equal(disclosure.props.open, undefined)
  assert.equal(disclosure.children.find((node) => node.type === 'summary').props.children, '提醒说明')
  assert.match(h.text(disclosure), /倒计时仅在页面内显示；当前版本不会发送系统通知，关闭页面后也不会弹窗提醒。/)
})
