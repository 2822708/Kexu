import { request } from './client'
import { streamMessage } from './stream'
import type {
  AiConfig,
  AiContextSummary,
  AiConversation,
  AiMessage,
  AuthVerifyResponse,
  Course,
  CoursePayload,
  CursorPage,
  Exam,
  ExamPayload,
  ParseHtmlResult,
  PeriodConfig,
  RecurringScriptTemplate,
  RecurringScriptTestResult,
  RecurringTodo,
  RecurringTodoPayload,
  Schedule,
  Todo,
} from '../types'

export const authApi = {
  verify: (apiKey: string) =>
    request<AuthVerifyResponse>('/auth/verify', {
      apiKey,
      notifyUnauthorized: false,
      timeoutMs: 20000,
    }),
  device: (deviceKey: string) =>
    request<AuthVerifyResponse>('/auth/device', {
      method: 'POST',
      body: { deviceKey },
      apiKey: '',
      notifyUnauthorized: false,
      timeoutMs: 20000,
    }),
}

export const scheduleApi = {
  list: () => request<Schedule[]>('/schedules'),
  create: (body: Omit<Schedule, 'id'>) => request<Schedule>('/schedules', { method: 'POST', body }),
  update: (id: number, body: Omit<Schedule, 'id'>) =>
    request<Schedule>(`/schedules/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<null>(`/schedules/${id}`, { method: 'DELETE' }),
}

export const courseApi = {
  listBySchedule: (scheduleId: number) => request<Course[]>(`/schedules/${scheduleId}/courses`),
  create: (scheduleId: number, body: CoursePayload) =>
    request<Course>(`/schedules/${scheduleId}/courses`, { method: 'POST', body }),
  batchCreate: (scheduleId: number, courses: CoursePayload[]) =>
    request<Course[]>(`/schedules/${scheduleId}/courses/batch`, {
      method: 'POST',
      body: { courses },
    }),
  update: (id: number, body: CoursePayload) =>
    request<Course>(`/courses/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<null>(`/courses/${id}`, { method: 'DELETE' }),
}

export const todoApi = {
  list: () => request<Todo[]>('/todos'),
  create: (body: { title: string; ddl: string }) =>
    request<Todo>('/todos', { method: 'POST', body }),
  update: (id: number, body: { title: string; ddl: string }) =>
    request<Todo>(`/todos/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<null>(`/todos/${id}`, { method: 'DELETE' }),
  toggle: (id: number) => request<Todo>(`/todos/${id}/toggle`, { method: 'PUT' }),
}

export const recurringApi = {
  list: () => request<RecurringTodo[]>('/recurring-todos'),
  create: (body: RecurringTodoPayload) =>
    request<RecurringTodo>('/recurring-todos', { method: 'POST', body }),
  update: (id: number, body: RecurringTodoPayload) =>
    request<RecurringTodo>(`/recurring-todos/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<null>(`/recurring-todos/${id}`, { method: 'DELETE' }),
  toggle: (id: number) =>
    request<RecurringTodo>(`/recurring-todos/${id}/toggle`, { method: 'PUT' }),
  triggerNow: (id: number) =>
    request<RecurringTodo>(`/recurring-todos/${id}/trigger`, { method: 'POST' }),
  scriptTemplate: () => request<RecurringScriptTemplate>('/recurring-todos/script-template'),
  testScript: (script: string) =>
    request<RecurringScriptTestResult>('/recurring-todos/test-script', {
      method: 'POST',
      body: { script },
    }),
}

export const examApi = {
  listBySchedule: (scheduleId: number) => request<Exam[]>(`/schedules/${scheduleId}/exams`),
  create: (scheduleId: number, body: ExamPayload) =>
    request<Exam>(`/schedules/${scheduleId}/exams`, { method: 'POST', body }),
  update: (id: number, body: ExamPayload) => request<Exam>(`/exams/${id}`, { method: 'PUT', body }),
  remove: (id: number) => request<null>(`/exams/${id}`, { method: 'DELETE' }),
}

export const periodApi = {
  list: () => request<PeriodConfig[]>('/period-config'),
  update: (configs: PeriodConfig[]) =>
    request<PeriodConfig[]>('/period-config', { method: 'PUT', body: { configs } }),
}

export const aiApi = {
  status: () => request<{ enabled: boolean }>('/ai/status'),
  /** 读取 AI 配置（只返回掩码后的 Key） */
  getConfig: () => request<AiConfig>('/ai/config'),
  /** 保存 DeepSeek Key 到本机（桌面版由用户在设置页填写） */
  saveConfig: (key: string) => request<AiConfig>('/ai/config', { method: 'PUT', body: { key } }),
  /** 清除本机保存的 Key，回退到环境变量/配置文件 */
  clearConfig: () => request<AiConfig>('/ai/config', { method: 'DELETE' }),
  listConversations: () => request<AiConversation[]>('/ai/conversations'),
  pageConversations: (cursor: string | null = null) =>
    request<CursorPage<AiConversation>>(
      `/ai/conversations/page?pageSize=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  createConversation: (scheduleId: number | null) =>
    request<AiConversation>('/ai/conversations', {
      method: 'POST',
      body: { scheduleId },
    }),
  deleteConversation: (id: number) =>
    request<null>(`/ai/conversations/${id}`, { method: 'DELETE' }),
  renameConversation: (id: number, title: string) =>
    request<AiConversation>(`/ai/conversations/${id}`, {
      method: 'PUT',
      body: { title },
    }),
  listMessages: (id: number) => request<AiMessage[]>(`/ai/conversations/${id}/messages`),
  /** 上下文注入摘要（五段式：档案/课表/任务/记忆），供输入框上方 chips 展示 */
  contextSummary: (id: number) =>
    request<AiContextSummary>(`/ai/conversations/${id}/context`),
  pageMessages: (id: number, beforeId: string | null = null) =>
    request<CursorPage<AiMessage>>(
      `/ai/conversations/${id}/messages/page?pageSize=40${beforeId ? `&beforeId=${encodeURIComponent(beforeId)}` : ''}`,
    ),
  sendMessageStream: streamMessage,
  execute: (id: number, actionId: number) =>
    request<AiMessage>(`/ai/conversations/${id}/actions/${actionId}/execute`, {
      method: 'POST',
    }),
  reject: (id: number, actionId: number) =>
    request<AiMessage>(`/ai/conversations/${id}/actions/${actionId}/reject`, {
      method: 'POST',
    }),
  parseHtml: (html: string, scheduleId: number | null) =>
    request<ParseHtmlResult>(`/ai/parse-html${scheduleId ? `?scheduleId=${scheduleId}` : ''}`, {
      method: 'POST',
      body: { html },
    }),
  parseImageText: (imageDataUrl: string) =>
    request<{ text: string }>('/ai/parse-image', {
      method: 'POST',
      body: { imageDataUrl },
    }),
}
