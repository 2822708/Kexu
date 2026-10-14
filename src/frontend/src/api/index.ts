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
  DailyPlan,
  DashboardData,
  Exam,
  ExamPayload,
  ParseHtmlResult,
  PeriodConfig,
  RecurringScriptTemplate,
  RecurringScriptTestResult,
  RecurringTodo,
  RecurringTodoPayload,
  Schedule,
  Task,
  TaskDraft,
  TaskExtractResult,
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

export const taskApi = {
  /**
   * 材料 → 任务草稿（AI Campus Agent V1.0 Step 4）。
   * 二选一：text（客户端已提取的文本）或 imageDataUrl（截图，视觉模型直提）。
   * 草稿不落库，用户核对/编辑后调 create。
   */
  extract: (body: { text?: string; imageDataUrl?: string }) =>
    request<TaskExtractResult>('/tasks/extract', { method: 'POST', body }),
  /** 批量创建任务（草稿确认 / 手动创建），后端标注 source=AI_PARSE */
  create: (tasks: TaskDraft[]) =>
    request<Task[]>('/tasks', { method: 'POST', body: { tasks } }),
  /** 任务列表：按截止升序（无截止排最后），可按状态/类型/截止窗口筛选 */
  list: (filters: {
    status?: string
    type?: string
    deadlineBefore?: string
    deadlineAfter?: string
  } = {}) => {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.type) params.set('type', filters.type)
    if (filters.deadlineBefore) params.set('deadlineBefore', filters.deadlineBefore)
    if (filters.deadlineAfter) params.set('deadlineAfter', filters.deadlineAfter)
    const query = params.toString()
    return request<Task[]>(`/tasks${query ? `?${query}` : ''}`)
  },
  get: (id: number) => request<Task>(`/tasks/${id}`),
  /** 修改任务（补丁语义：title 必填，其余字段缺省保持原值，deadline=null 显式清除） */
  update: (id: number, body: Partial<TaskDraft> & { status?: string }) =>
    request<Task>(`/tasks/${id}`, { method: 'PUT', body }),
  /** 状态流转：PENDING / IN_PROGRESS / DONE / CANCELLED */
  updateStatus: (id: number, status: string) =>
    request<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
  remove: (id: number) => request<null>(`/tasks/${id}`, { method: 'DELETE' }),
}

/**
 * AI Dashboard 聚合（AI Campus Agent V1.0 Step 5）。
 * 一次请求返回首页所需的档案/今日课程/今日任务/48h 截止/考试倒计时/规则重点。
 */
export const dashboardApi = {
  get: (params: { date?: string; scheduleId?: number | null } = {}) => {
    const query = new URLSearchParams()
    if (params.date) query.set('date', params.date)
    if (params.scheduleId != null) query.set('scheduleId', String(params.scheduleId))
    const suffix = query.toString()
    return request<DashboardData>(`/dashboard${suffix ? `?${suffix}` : ''}`)
  },
}

/**
 * AI 每日计划（AI Campus Agent V1.0 Step 6）。
 * GET 只读缓存（首页加载不烧 token）；POST 触发生成，同一天第二次命中缓存。
 */
export const planApi = {
  get: (date?: string) =>
    request<DailyPlan | null>(`/plans/daily${date ? `?date=${date}` : ''}`),
  generate: (body: { date?: string; scheduleId?: number | null } = {}) =>
    request<DailyPlan>('/plans/daily', { method: 'POST', body }),
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
