import LocalAppProvider from './LocalAppProvider'
import { LOCAL_MODE } from '../local/mode'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { message } from 'antd'
import { getApiKey, invalidateSessionRequests, onUnauthorized } from '../api/client'
import { connectDevice, DEVICE_KEY_STORAGE } from '../api/deviceSession'
import { courseApi, examApi, periodApi, recurringApi, scheduleApi, todoApi } from '../api'
import type { Course, Exam, PeriodConfig, RecurringTodo, Schedule, Todo } from '../types'

const ACTIVE_SCHEDULE_STORAGE = 'timetable.activeScheduleId'
const SYNC_INTERVAL_MS = 30_000

export interface AppState {
  ready: boolean
  authed: boolean
  connectionError: string | null
  reconnect: () => Promise<void>
  label: string
  isAdmin: boolean
  avatarUrl: string | null
  schedules: Schedule[]
  activeScheduleId: number | null
  activeSchedule: Schedule | null
  courses: Course[]
  exams: Exam[]
  todos: Todo[]
  recurringTodos: RecurringTodo[]
  periods: PeriodConfig[]
  loading: boolean
  setActiveScheduleId: (id: number | null) => void
  refreshSchedules: () => Promise<Schedule[]>
  refreshCourses: () => Promise<void>
  refreshExams: () => Promise<void>
  refreshTodos: () => Promise<void>
  refreshRecurring: () => Promise<void>
  refreshPeriods: () => Promise<void>
  refreshAll: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

function readActiveSchedule(): number | null {
  try {
    const stored = localStorage.getItem(ACTIVE_SCHEDULE_STORAGE)
    const id = stored ? Number(stored) : NaN
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

function ServerAppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [activeScheduleId, setActiveScheduleIdState] = useState<number | null>(readActiveSchedule)
  const [courses, setCourses] = useState<Course[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [recurringTodos, setRecurringTodos] = useState<RecurringTodo[]>([])
  const [periods, setPeriods] = useState<PeriodConfig[]>([])
  const [loading, setLoading] = useState(false)

  const activeIdRef = useRef(activeScheduleId)
  activeIdRef.current = activeScheduleId
  const authEpoch = useRef(0)
  const sessionKey = useRef<string | null>(null)
  const schedulesRequestSeq = useRef(0)
  const coursesRequestSeq = useRef(0)
  const examsRequestSeq = useRef(0)
  const todosRequestSeq = useRef(0)
  const recurringRequestSeq = useRef(0)
  const periodsRequestSeq = useRef(0)

  const isCurrentSession = useCallback((epoch: number) => {
    try {
      return (
        epoch === authEpoch.current &&
        sessionKey.current !== null &&
        sessionKey.current === getApiKey()
      )
    } catch {
      return false
    }
  }, [])

  const setActiveScheduleId = useCallback((id: number | null) => {
    activeIdRef.current = id
    setActiveScheduleIdState(id)
    if (id === null) localStorage.removeItem(ACTIVE_SCHEDULE_STORAGE)
    else localStorage.setItem(ACTIVE_SCHEDULE_STORAGE, String(id))
  }, [])

  const clearSessionView = useCallback(() => {
    invalidateSessionRequests()
    authEpoch.current += 1
    sessionKey.current = null
    setAuthed(false)
    setLabel('')
    setIsAdmin(false)
    setAvatarUrl(null)
    setSchedules([])
    setCourses([])
    setExams([])
    setTodos([])
    setRecurringTodos([])
    setPeriods([])
    setLoading(false)
    activeIdRef.current = null
    setActiveScheduleIdState(null)
  }, [])

  const reconnect = useCallback(async () => {
    clearSessionView()
    const epoch = authEpoch.current
    setReady(false)
    setConnectionError(null)
    try {
      const result = await connectDevice()
      if (epoch !== authEpoch.current) return
      sessionKey.current = getApiKey()
      activeIdRef.current = readActiveSchedule()
      setActiveScheduleIdState(activeIdRef.current)
      setLabel(result.label)
      setIsAdmin(result.role === 'ADMIN')
      setAvatarUrl(result.avatarUrl ?? null)
      setAuthed(true)
    } catch (error) {
      if (epoch !== authEpoch.current) return
      setConnectionError(error instanceof Error ? error.message : '设备连接失败，请重试。')
    } finally {
      if (epoch === authEpoch.current) setReady(true)
    }
  }, [clearSessionView])

  useEffect(
    () =>
      onUnauthorized((key) => {
        if (!key || key !== sessionKey.current || !isCurrentSession(authEpoch.current)) return
        clearSessionView()
        setReady(true)
        setConnectionError(
          '本机连接已失效，已保留原有连接信息。请重新连接；若账户已停用，请联系管理员恢复。',
        )
      }),
    [clearSessionView, isCurrentSession],
  )

  useEffect(() => {
    void reconnect()
    const onStorage = (event: StorageEvent) => {
      if (!sessionKey.current) return
      if (
        event.key === null ||
        event.key === 'timetable.apiKey' ||
        event.key === DEVICE_KEY_STORAGE
      ) {
        void reconnect()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      invalidateSessionRequests()
      authEpoch.current += 1
      sessionKey.current = null
      window.removeEventListener('storage', onStorage)
    }
  }, [reconnect])

  const refreshSchedules = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return []
    const requestSeq = ++schedulesRequestSeq.current
    const list = await scheduleApi.list()
    if (!isCurrentSession(epoch) || requestSeq !== schedulesRequestSeq.current) return list
    setSchedules(list)
    const currentId = activeIdRef.current
    if (list.length === 0) setActiveScheduleId(null)
    else if (currentId === null || !list.some((s) => s.id === currentId))
      setActiveScheduleId(list[0].id)
    return list
  }, [isCurrentSession, setActiveScheduleId])

  const refreshCourses = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    const id = activeIdRef.current
    const requestSeq = ++coursesRequestSeq.current
    if (id === null) {
      setCourses([])
      return
    }
    const result = await courseApi.listBySchedule(id)
    if (
      isCurrentSession(epoch) &&
      requestSeq === coursesRequestSeq.current &&
      activeIdRef.current === id
    )
      setCourses(result)
  }, [isCurrentSession])

  const refreshExams = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    const id = activeIdRef.current
    const requestSeq = ++examsRequestSeq.current
    if (id === null) {
      setExams([])
      return
    }
    const result = await examApi.listBySchedule(id)
    if (
      isCurrentSession(epoch) &&
      requestSeq === examsRequestSeq.current &&
      activeIdRef.current === id
    )
      setExams(result)
  }, [isCurrentSession])

  const refreshTodos = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    const requestSeq = ++todosRequestSeq.current
    const result = await todoApi.list()
    if (isCurrentSession(epoch) && requestSeq === todosRequestSeq.current) setTodos(result)
  }, [isCurrentSession])

  const refreshRecurring = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    const requestSeq = ++recurringRequestSeq.current
    const result = await recurringApi.list()
    if (isCurrentSession(epoch) && requestSeq === recurringRequestSeq.current)
      setRecurringTodos(result)
  }, [isCurrentSession])

  const refreshPeriods = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    const requestSeq = ++periodsRequestSeq.current
    const result = await periodApi.list()
    if (isCurrentSession(epoch) && requestSeq === periodsRequestSeq.current) setPeriods(result)
  }, [isCurrentSession])

  const refreshAll = useCallback(async () => {
    const epoch = authEpoch.current
    if (!isCurrentSession(epoch)) return
    setLoading(true)
    try {
      await refreshSchedules()
      if (!isCurrentSession(epoch)) return
      await Promise.all([
        refreshCourses(),
        refreshExams(),
        refreshTodos(),
        refreshRecurring(),
        refreshPeriods(),
      ])
    } finally {
      if (isCurrentSession(epoch)) setLoading(false)
    }
  }, [
    isCurrentSession,
    refreshCourses,
    refreshExams,
    refreshPeriods,
    refreshRecurring,
    refreshSchedules,
    refreshTodos,
  ])

  useEffect(() => {
    if (!authed) return
    refreshAll().catch((e: Error) => message.error(e.message))
  }, [authed, refreshAll])

  useEffect(() => {
    if (!authed) return
    Promise.all([refreshCourses(), refreshExams()]).catch((e: Error) => message.error(e.message))
  }, [authed, activeScheduleId, refreshCourses, refreshExams])

  useEffect(() => {
    if (!authed) return
    const timer = window.setInterval(() => {
      Promise.all([refreshCourses(), refreshExams(), refreshTodos(), refreshRecurring()]).catch(
        () => {
          // Background synchronization may retry at the next scheduled interval.
        },
      )
    }, SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [authed, refreshCourses, refreshExams, refreshTodos, refreshRecurring])

  const activeSchedule = useMemo(
    () => schedules.find((s) => s.id === activeScheduleId) ?? null,
    [schedules, activeScheduleId],
  )

  const value: AppState = {
    ready,
    authed,
    connectionError,
    reconnect,
    label,
    isAdmin,
    avatarUrl,
    schedules,
    activeScheduleId,
    activeSchedule,
    courses,
    exams,
    todos,
    recurringTodos,
    periods,
    loading,
    setActiveScheduleId,
    refreshSchedules,
    refreshCourses,
    refreshExams,
    refreshTodos,
    refreshRecurring,
    refreshPeriods,
    refreshAll,
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function AppProvider({ children }: { children: ReactNode }) {
  return LOCAL_MODE ? (
    <LocalAppProvider context={AppContext}>{children}</LocalAppProvider>
  ) : (
    <ServerAppProvider>{children}</ServerAppProvider>
  )
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
