import { readCompatiblePreference, removeCompatiblePreference } from '../../../shared/brandCompatibility.mjs'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from 'react'
import { message } from 'antd'
import type { AppState } from './AppContext'
import { initializeLocalStore, readLocalState, subscribeLocalChanges } from '../local/db'
import { runLocalMaintenance } from '../local/domain'
import type { LocalState } from '../local/types'
import { startAutoBackup } from '../backup/coordinator'

const SELECTION_KEY = 'kexu.local.activeSchedulePublicId'
const STARTUP_TIMEOUT_MS = 15_000

/** 启动耗时打点；性能测量失败绝不能影响启动。 */
function mark(name: string) {
  try {
    performance.mark(name)
  } catch {
    /* ignore */
  }
}
const collections = [
  'schedules',
  'courses',
  'exams',
  'todos',
  'periods',
  'focusCompletions',
  'recurringRules',
  'recurringOccurrences',
  'conversations',
  'messages',
] as const
function selectedPublicId() {
  try {
    return readCompatiblePreference(localStorage, SELECTION_KEY)
  } catch {
    return null
  }
}

export default function LocalAppProvider({
  children,
  context,
}: {
  children: ReactNode
  context: Context<AppState | null>
}) {
  const [ready, setReady] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [data, setData] = useState<LocalState | null>(null)
  const [activeScheduleId, setActiveId] = useState<number | null>(null)
  const dataRef = useRef<LocalState | null>(null)
  const selectedRef = useRef(selectedPublicId())
  const sequence = useRef(0)

  const setActiveScheduleId = useCallback((id: number | null) => {
    const selected = dataRef.current?.schedules.find((item) => item.id === id)
    selectedRef.current = selected?.publicId ?? null
    setActiveId(selected?.id ?? null)
    try {
      if (selected) localStorage.setItem(SELECTION_KEY, selected.publicId)
      else removeCompatiblePreference(localStorage, SELECTION_KEY)
    } catch {
      /* A preference failure must not invalidate a committed business write. */
    }
  }, [])

  const applyState = useCallback((incoming: LocalState) => {
    const previous = dataRef.current
    if (previous)
      for (const key of collections) {
        if (JSON.stringify(previous[key]) === JSON.stringify(incoming[key]))
          Object.assign(incoming, { [key]: previous[key] })
      }
    dataRef.current = incoming
    setData(incoming)
    const selected =
      incoming.schedules.find((item) => item.publicId === selectedRef.current) ??
      incoming.schedules[0]
    setActiveScheduleId(selected?.id ?? null)
  }, [setActiveScheduleId])

  const load = useCallback(async () => {
    const request = ++sequence.current
    const incoming = await readLocalState()
    if (request === sequence.current) applyState(incoming)
    return incoming
  }, [applyState])

  const reconnect = useCallback(async () => {
    // Reloading releases this page's pending IndexedDB requests before retrying.
    window.location.reload()
  }, [])

  useEffect(() => {
    let active = true
    const fail = (error: unknown) => {
      if (!active) return
      active = false
      setConnectionError(
        error instanceof Error ? error.message : '本地数据无法打开，请检查浏览器存储权限',
      )
      setReady(true)
    }
    const timer = window.setTimeout(() => {
      fail(new Error('读取本机数据超时。请关闭其他 Kexu 页面后重新加载。'))
    }, STARTUP_TIMEOUT_MS)

    async function start() {
      mark('kexu:init:start')
      try {
        await initializeLocalStore()
        if (!active) return
        mark('kexu:init:done')
        // 维护在首屏前完成，避免列表在打开瞬间跳动。
        await runLocalMaintenance()
        if (!active) return
        mark('kexu:maintenance:done')
        const incoming = await readLocalState()
        if (!active) return
        applyState(incoming)
        mark('kexu:first-load:done')
        setReady(true)
      } catch (error) {
        fail(error)
      } finally {
        window.clearTimeout(timer)
      }
    }
    void start()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [applyState])

  useEffect(() => {
    if (!ready || connectionError) return
    let active = true
    const refresh = () => {
      if (active)
        void load().catch((error) =>
          message.error(error instanceof Error ? error.message : '本地数据读取失败'),
        )
    }
    const stopChanges = subscribeLocalChanges(refresh)
    // Reconcile writes from another tab between the first read and subscription.
    refresh()
    const stopBackup = startAutoBackup()
    const maintain = () => {
      if (document.visibilityState === 'visible')
        void runLocalMaintenance()
          .then(refresh)
          .catch(() => {})
    }
    const timer = window.setInterval(maintain, 60_000)
    document.addEventListener('visibilitychange', maintain)
    window.addEventListener('focus', maintain)
    window.addEventListener('storage', refresh)
    return () => {
      active = false
      sequence.current += 1
      stopChanges()
      stopBackup()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', maintain)
      window.removeEventListener('focus', maintain)
      window.removeEventListener('storage', refresh)
    }
  }, [connectionError, load, ready])

  const refreshAll = useCallback(async () => {
    await load()
  }, [load])
  const refreshSchedules = useCallback(async () => (await load()).schedules, [load])
  const activeSchedule = useMemo(
    () => data?.schedules.find((item) => item.id === activeScheduleId) ?? null,
    [data?.schedules, activeScheduleId],
  )
  const courses = useMemo(
    () => data?.courses.filter((item) => item.scheduleId === activeScheduleId) ?? [],
    [data?.courses, activeScheduleId],
  )
  const exams = useMemo(
    () => data?.exams.filter((item) => item.scheduleId === activeScheduleId) ?? [],
    [data?.exams, activeScheduleId],
  )
  const value: AppState = {
    ready,
    authed: ready && data !== null && !connectionError,
    connectionError,
    reconnect,
    label: '本机数据',
    isAdmin: true,
    avatarUrl: null,
    schedules: data?.schedules ?? [],
    activeScheduleId,
    activeSchedule,
    courses,
    exams,
    todos: data?.todos ?? [],
    recurringTodos: data?.recurringRules ?? [],
    periods: data?.periods ?? [],
    loading: !ready,
    setActiveScheduleId,
    refreshSchedules,
    refreshCourses: refreshAll,
    refreshExams: refreshAll,
    refreshTodos: refreshAll,
    refreshRecurring: refreshAll,
    refreshPeriods: refreshAll,
    refreshAll,
  }
  const Provider = context.Provider
  return <Provider value={value}>{children}</Provider>
}
