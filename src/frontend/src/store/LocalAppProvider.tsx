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
  const [loading, setLoading] = useState(true)
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

  const load = useCallback(async () => {
    const request = ++sequence.current
    const incoming = await readLocalState()
    if (request !== sequence.current) return incoming
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
    return incoming
  }, [setActiveScheduleId])

  const reconnect = useCallback(async () => {
    setLoading(true)
    setConnectionError(null)
    try {
      await initializeLocalStore()
      await runLocalMaintenance()
      await load()
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : '本地数据无法打开，请检查浏览器存储权限',
      )
    } finally {
      setReady(true)
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    let active = true
    let stopBackup = () => {}
    const refresh = () => {
      if (active)
        void load().catch((error) =>
          message.error(error instanceof Error ? error.message : '本地数据读取失败'),
        )
    }
    const stopChanges = subscribeLocalChanges(refresh)
    void reconnect().then(() => {
      if (active && dataRef.current) stopBackup = startAutoBackup()
    })
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
  }, [load, reconnect])

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
    loading,
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
