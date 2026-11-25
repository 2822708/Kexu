import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import * as brandCompatibility from '../../shared/brandCompatibility.mjs'

const require = createRequire(import.meta.url)
const { act, createContext, createElement: h, useContext, useLayoutEffect } = require('react')
const { createRoot } = require('react-dom/client')
const { MemoryRouter, useLocation } = require('react-router-dom')

const historicalDate = '2026-10-19'
const currentDate = '2026-11-18'

function loadSource(path, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const exports = {}
  new Function('exports', 'require', outputText)(exports, (id) =>
    Object.hasOwn(dependencies, id) ? dependencies[id] : require(id),
  )
  return exports
}

function fixture(generation, title) {
  return {
    dataGeneration: generation,
    schedules: [],
    courses: [],
    exams: [],
    periods: [],
    todos: [],
    recurringRules: [],
    dayEntries: [
      {
        kind: 'dayTask', publicId: 'historical', plannedDate: historicalDate,
        initialDate: historicalDate, title, completed: false, version: 1, position: 0,
      },
      {
        kind: 'dayTask', publicId: 'current', plannedDate: currentDate,
        initialDate: currentDate, title: 'Today’s task', completed: false, version: 1, position: 0,
      },
    ],
    dailyEvents: [],
  }
}

async function mount(t, { route, openStore, readState, loadDailyPage, preferredSchedule }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://kexu.example.test/' })
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [
    key, Object.getOwnPropertyDescriptor(globalThis, key),
  ]))
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const selectionKey = 'kexu.local.activeSchedulePublicId'
  if (preferredSchedule) localStorage.setItem(brandCompatibility.legacyNames.activeSchedule, preferredSchedule)
  const container = document.getElementById('root')
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  const context = createContext(null)
  const mode = { LOCAL_MODE: true }
  const localStateContext = loadSource('store/LocalStateContext.ts')
  let readCount = 0
  let subscriptions = 0
  const LocalAppProvider = loadSource('store/LocalAppProvider.tsx', {
    '../../../shared/brandCompatibility.mjs': brandCompatibility,
    antd: { message: { error: (message) => assert.fail(message) } },
    './LocalStateContext': localStateContext,
    '../local/db': {
      initializeLocalStore: openStore,
      readLocalState: () => readState(++readCount),
      subscribeLocalChanges: () => {
        subscriptions++
        return () => {}
      },
    },
    '../local/domain': { runLocalMaintenance: async () => {} },
    '../backup/coordinator': { startAutoBackup: () => () => {} },
  }).default
  const { useDailyWorkspace } = loadSource('hooks/useDailyWorkspace.ts', {
    '../local/daily/selectors': loadSource('local/daily/selectors.ts'),
    '../store/LocalStateContext': localStateContext,
  })
  const commits = []
  const layoutCommits = []
  let refresh
  let selection
  function DailyProbe() {
    selection = useContext(context)
    const { pathname, search, hash } = useLocation()
    const date = new URLSearchParams(search).get('date') ?? currentDate
    const { workspace, refresh: refreshWorkspace } = useDailyWorkspace(date)
    const titles = workspace?.entries.map(({ title }) => title).join(', ')
    useLayoutEffect(() => {
      refresh = refreshWorkspace
      commits.push({ path: pathname + search + hash, titles, generation: workspace?.generation })
    }, [pathname, search, hash, titles, workspace, refreshWorkspace])
    return h('p', { id: 'daily-workspace' }, titles ?? 'Task workspace is not ready')
  }
  function LegacySpin() {
    return h('p', { id: 'legacy-spin' })
  }
  const focusPage = loadSource('pages/FocusPage.tsx', {
    '../local/mode': mode,
    './LocalDailyPage': loadDailyPage.then(() => ({ default: DailyProbe })),
    antd: { Spin: LegacySpin },
  })
  const tasksPage = loadSource('pages/TasksPage.tsx', {
    '../local/mode': mode,
    './FocusPage': focusPage,
    './TodosPage': { default: () => null },
    '../components/RecurringTodoPanel': { default: () => null },
    '../tasks-page.css': {},
    '@ant-design/icons': { CheckOutlined: () => null, DownOutlined: () => null },
    antd: {
      Dropdown: ({ children }) => children,
      Tabs: ({ activeKey, items }) => items.find(({ key }) => key === activeKey).children,
    },
  })
  const App = loadSource('App.tsx', {
    './local/mode': mode,
    './pages/TasksPage': tasksPage,
    './pages/DeviceConnectionPage': { default: () => null },
    './components/BootScreen': loadSource('components/BootScreen.tsx'),
    './components/SwipePager': { default: ({ children }) => children },
    './components/AppLayout': {
      default: ({ children }) => {
        useLayoutEffect(() => { layoutCommits.push(container.textContent) }, [])
        return h('main', null, children)
      },
    },
    './store/AppContext': { useApp: () => useContext(context) },
  }).default
  await act(async () => {
    root.render(h(MemoryRouter, {
      initialEntries: [route],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    }, h(LocalAppProvider, { context }, h(App))))
  })
  return {
    container, commits, layoutCommits,
    readCount: () => readCount,
    subscriptions: () => subscriptions,
    refresh: () => refresh(),
    selection: () => selection.activeScheduleId,
    select: (id) => selection.setActiveScheduleId(id),
    preference: () => localStorage.getItem(selectionKey),
    otherTabSelect(publicId) {
      localStorage.setItem(selectionKey, publicId)
      window.dispatchEvent(new window.StorageEvent('storage', { key: selectionKey, newValue: publicId }))
    },
  }
}

test('provider keeps each tab selection and only persists an explicit choice', async (t) => {
  const state = {
    ...fixture('initial', 'Historical task'),
    schedules: [{ id: 1, publicId: 'first' }, { id: 2, publicId: 'second' }],
  }
  const session = await mount(t, {
    route: '/tasks',
    openStore: async () => {},
    readState: async () => structuredClone(state),
    loadDailyPage: Promise.resolve(),
    preferredSchedule: 'second',
  })
  assert.equal(session.selection(), 2)
  assert.equal(session.preference(), null, 'reading the legacy preference is side-effect free')
  await act(async () => session.select(1))
  assert.equal(session.selection(), 1)
  assert.equal(session.preference(), 'first')
  const reads = session.readCount()
  await act(async () => session.otherTabSelect('second'))
  assert.equal(session.selection(), 1)
  assert.equal(session.readCount(), reads)
  await act(async () => { await session.refresh() })
  assert.equal(session.selection(), 1)
  assert.equal(session.preference(), 'second', 'refresh does not write the local preference back')
})

test('Android task alias stays on the splash until the first historical workspace is ready', async (t) => {
  const firstRead = Promise.withResolvers()
  const reconcile = Promise.withResolvers()
  const dailyModule = Promise.withResolvers()
  const session = await mount(t, {
    route: `/focus?date=${historicalDate}#review`,
    openStore: async () => {},
    readState: (count) => count === 1 ? firstRead.promise : reconcile.promise,
    loadDailyPage: dailyModule.promise,
  })
  const { container, commits, layoutCommits } = session
  assert.ok(container.querySelector('.boot-splash'))
  assert.equal(session.readCount(), 1)

  await act(async () => firstRead.resolve(fixture('initial', 'Saved historical task')))
  assert.ok(container.querySelector('.boot-splash'))
  assert.equal(container.querySelector('main, #legacy-spin'), null)
  assert.equal(layoutCommits.length, 0, 'the alias and nested lazy module must not paint empty task chrome')

  await act(async () => dailyModule.resolve())
  assert.deepEqual(commits[0], {
    path: `/tasks?date=${historicalDate}&view=today#review`,
    titles: 'Saved historical task',
    generation: 'initial',
  })
  assert.equal(container.querySelector('.boot-splash'), null)
  assert.equal(container.querySelector('#daily-workspace').textContent, 'Saved historical task')
  assert.equal(session.subscriptions(), 1)
  assert.equal(session.readCount(), 2, 'only initial read and provider reconciliation are allowed')
})

test('refresh replaces the task workspace with the restored snapshot', async (t) => {
  let state = fixture('initial', 'Old task')
  const session = await mount(t, {
    route: `/tasks?date=${historicalDate}`,
    openStore: async () => {},
    readState: async () => state,
    loadDailyPage: Promise.resolve(),
  })
  assert.equal(session.commits[0]?.titles, 'Old task')

  state = fixture('restored', 'Restored task')
  let fresh
  await act(async () => { fresh = await session.refresh() })
  assert.equal(fresh.generation, 'restored')
  assert.equal(session.commits.at(-1).titles, 'Restored task')
  assert.equal(session.commits.at(-1).generation, 'restored')
})

test('a database opening failure displays the retry screen without mounting task content', async (t) => {
  const session = await mount(t, {
    route: '/tasks',
    openStore: async () => { throw new Error('Storage unavailable') },
    readState: async () => assert.fail('must not read after a failed open'),
    loadDailyPage: Promise.resolve(),
  })
  assert.match(session.container.querySelector('[role=alert]').textContent, /Storage unavailable/)
  assert.equal(session.container.querySelector('button').textContent, '重新加载')
  assert.equal(session.layoutCommits.length, 0)
  assert.equal(session.readCount(), 0)
})
