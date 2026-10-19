import type {
  AiConversation,
  AiMessage,
  Course,
  Exam,
  PeriodConfig,
  RecurringTodo,
  Schedule,
  Todo,
} from '../types'
import type { DailyEvent, DailyReview, DayEntry } from './daily/types'

export type LocalSchedule = Schedule & { publicId: string }
export type LocalCourse = Course & { publicId: string }
export type LocalExam = Exam & { publicId: string }
export type LocalTodo = Todo & { publicId: string; chainGenerated?: boolean; dailyVersion?: number }
export type LocalRecurringTodo = RecurringTodo & { publicId: string }
export type LocalPeriodConfig = PeriodConfig & { publicId: string }
export type LocalConversation = AiConversation & { publicId: string }
export type LocalMessage = AiMessage & { publicId: string; conversationId: number }
export interface LocalFocusCompletion {
  publicId: string
  scheduleId: number
  courseId: number
  date: string
  completed: boolean
}
export interface LocalRecurringOccurrence {
  publicId: string
  recurringId: number
  scheduledAt: string
  todoId: number | null
}
export interface LocalState {
  schemaVersion: 2
  dataGeneration: string
  datasetId: string
  revision: number
  nextId: number
  createdAt: string
  updatedAt: string
  schedules: LocalSchedule[]
  courses: LocalCourse[]
  exams: LocalExam[]
  todos: LocalTodo[]
  periods: LocalPeriodConfig[]
  focusCompletions: LocalFocusCompletion[]
  recurringRules: LocalRecurringTodo[]
  recurringOccurrences: LocalRecurringOccurrence[]
  conversations: LocalConversation[]
  messages: LocalMessage[]
  dayEntries: DayEntry[]
  dailyEvents: DailyEvent[]
  dailyReviews: DailyReview[]
}

export function newPublicId(): string {
  if (!globalThis.crypto?.randomUUID)
    throw new Error('当前浏览器不支持安全本地存储，请使用 HTTPS 或 localhost 打开应用')
  return crypto.randomUUID()
}

export function nextLocalId(state: LocalState): number {
  if (
    !Number.isSafeInteger(state.nextId) ||
    state.nextId < 1 ||
    state.nextId >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('本地编号已达到上限')
  return state.nextId++
}

const defaultTimes = [
  ['08:00:00', '08:45:00'],
  ['08:55:00', '09:40:00'],
  ['10:00:00', '10:45:00'],
  ['10:55:00', '11:40:00'],
  ['14:00:00', '14:45:00'],
  ['14:55:00', '15:40:00'],
  ['16:00:00', '16:45:00'],
  ['16:55:00', '17:40:00'],
  ['19:00:00', '19:45:00'],
  ['19:55:00', '20:40:00'],
  ['20:50:00', '21:35:00'],
  ['21:45:00', '22:30:00'],
]

export function createEmptyLocalState(): LocalState {
  const now = new Date().toISOString()
  return {
    schemaVersion: 2,
    dataGeneration: newPublicId(),
    datasetId: newPublicId(),
    revision: 0,
    nextId: 1,
    createdAt: now,
    updatedAt: now,
    schedules: [],
    courses: [],
    exams: [],
    todos: [],
    recurringRules: [],
    recurringOccurrences: [],
    focusCompletions: [],
    conversations: [],
    messages: [],
    dayEntries: [],
    dailyEvents: [],
    dailyReviews: [],
    periods: defaultTimes.map(([startTime, endTime], i) => ({
      publicId: newPublicId(),
      periodNumber: i + 1,
      startTime,
      endTime,
      category: i < 4 ? 'MORNING' : i < 8 ? 'AFTERNOON' : 'EVENING',
    })),
  }
}
