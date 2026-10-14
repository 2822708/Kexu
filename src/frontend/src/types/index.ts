export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface AuthVerifyResponse {
  valid: boolean
  label: string
  avatarUrl: string | null
  role: 'ADMIN' | 'USER'
}

export interface Schedule {
  id: number
  apiKey?: string
  name: string
  periodStartDate: string
  periodEndDate: string
  createdAt?: string
  updatedAt?: string
}

export interface Course {
  id: number
  scheduleId: number
  name: string
  location: string | null
  teacher: string | null
  dayOfWeek: number
  startPeriod: number
  endPeriod: number
  weeks: number[]
  createdAt?: string
  updatedAt?: string
}

export type CoursePayload = Omit<Course, 'id' | 'scheduleId' | 'createdAt' | 'updatedAt'>

/** 考试记录：不按课时，直接输入起止时间，展示为独立红色块 */
export interface Exam {
  id: number
  scheduleId: number
  name: string
  location: string | null
  examDate: string
  startTime: string
  endTime: string
  createdAt?: string
  updatedAt?: string
}

export type ExamPayload = Omit<Exam, 'id' | 'scheduleId' | 'createdAt' | 'updatedAt'>

export interface Todo {
  id: number
  title: string
  ddl: string
  completed: boolean
  /** 非空表示由循环规则自动生成 */
  recurringId: number | null
  /** 非空表示由考试自动关联生成（ddl=考试开始时间，考试结束后自动完成） */
  examId: number | null
  createdAt?: string
  updatedAt?: string
}

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'

export interface RecurringTodo {
  id: number
  title: string
  frequency: RecurringFrequency
  dayOfWeek: number | null
  dayOfMonth: number | null
  triggerTime: string | null
  /** CUSTOM 模式下的用户脚本，需定义 shouldTrigger(ctx) 返回布尔值 */
  script: string | null
  ddlOffsetMinutes: number
  enabled: boolean
  chainAfterComplete: boolean
  lastTriggeredAt: string | null
  nextTriggerAt: string | null
}

export type RecurringTodoPayload = Omit<RecurringTodo, 'id' | 'lastTriggeredAt' | 'nextTriggerAt'>

/** GET /api/recurring-todos/script-template 的返回 */
export interface RecurringScriptTemplate {
  template: string
  maxLength: number
  context: Record<string, unknown>
}

/** POST /api/recurring-todos/test-script 的返回 */
export interface RecurringScriptTestResult {
  valid: boolean
  triggeredNow: boolean
  error: string | null
}

export type PeriodCategory = 'MORNING' | 'AFTERNOON' | 'EVENING'

export interface PeriodConfig {
  periodNumber: number
  startTime: string
  endTime: string
  category: PeriodCategory
}

export type AiActionType =
  | 'CREATE_COURSE'
  | 'UPDATE_COURSE'
  | 'DELETE_COURSE'
  | 'CREATE_TODO'
  | 'UPDATE_TODO'
  | 'DELETE_TODO'
  | 'TOGGLE_TODO'
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'CREATE_RECURRING'
  | 'UPDATE_RECURRING'
  | 'DELETE_RECURRING'
  | 'TOGGLE_RECURRING'
  | 'CREATE_EXAM'
  | 'UPDATE_EXAM'
  | 'DELETE_EXAM'
  | 'SAVE_MEMORY'
  | 'UPDATE_PROFILE'

export type AiActionStatus = 'PENDING' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'STALE'

export type AiActionScope = 'COURSE' | 'TODO' | 'TASK' | 'PROFILE' | 'MEMORY'

/**
 * AI 聊天上下文注入摘要（五段式：档案/课表/任务/记忆）。
 * 计数为实际注入 system prompt 的条数（截断后），供输入框上方 chips 展示。
 */
export interface AiContextSummary {
  profilePresent: boolean
  courseCount: number
  taskCount: number
  memoryCount: number
  tasksTruncated: boolean
  memoriesTruncated: boolean
}

export interface AiAction {
  actionId: number
  type: AiActionType
  status: AiActionStatus
  scope: AiActionScope
  scheduleId?: number | null
  data: Record<string, unknown> | null
}

export interface AiMessage {
  messageId: number
  role: 'user' | 'assistant'
  text: string
  actions?: AiAction[]
  createdAt?: string
}

export interface AiConversation {
  id: number
  scheduleId: number | null
  title: string
  createdAt?: string
  updatedAt?: string
}

/** AI（DeepSeek）配置状态。后端只返回掩码后的 Key，绝不返回完整 Key。 */
export interface AiConfig {
  configured: boolean
  canEdit: boolean
  localSettingsEnabled: boolean
  /** 取值来源：local（界面填入）/ config（环境变量或配置文件）/ none */
  source: 'local' | 'config' | 'none'
  keyMasked: string
}

export interface ParsedCourse {
  name: string | null
  location: string | null
  teacher: string | null
  dayOfWeek: number | null
  startPeriod: number | null
  endPeriod: number | null
  weeks: number[]
}

export interface ParseHtmlResult {
  courses: ParsedCourse[]
  note: string
  diagnostics?: { row: number; message: string }[]
}

/** 任务类型（与后端白名单一致） */
export type TaskType = 'COURSE_WORK' | 'LAB_REPORT' | 'ONLINE_COURSE' | 'EXAM' | 'COMPETITION' | 'OTHER'

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'

/**
 * 任务草稿：AI 抽取产物与手动创建共用同一结构。
 * deadline 为 null 表示未设置——AI 抽取时严禁猜测时间。
 */
export interface TaskDraft {
  title: string
  type: TaskType
  deadline: string | null
  priority: number
  description: string
}

/** 任务实体（草稿经用户确认后落库） */
export interface Task {
  id: number
  title: string
  type: TaskType
  description: string | null
  deadline: string | null
  priority: number
  status: TaskStatus
  source: string
  createdAt?: string
  updatedAt?: string
}

/** 任务抽取结果：草稿不落库，confidence < 0.6 时前端强制逐条核对 */
export interface TaskExtractResult {
  tasks: TaskDraft[]
  confidence: number
  note: string
}

/** 每日计划块类型：课程 / 任务 / 休息 / 建议 */
export type DailyPlanItemType = 'COURSE' | 'TASK' | 'BREAK' | 'SUGGESTION'

export interface DailyPlanItem {
  /** HH:mm */
  start: string
  /** HH:mm */
  end: string
  type: DailyPlanItemType
  title: string
  /** COURSE→课程 id，TASK→任务 id，BREAK/SUGGESTION→null */
  refId: number | null
  note: string
}

/** AI 每日计划（Step 6）；cached=true 表示来自缓存（同一天已生成过） */
export interface DailyPlan {
  date: string
  items: DailyPlanItem[]
  summary: string
  cached: boolean
}

/** 学生档案（AI Campus Agent V1.0 Step 2 起由 AI 提案 + 设置页维护） */
export interface StudentProfile {
  id: number
  name: string | null
  school: string | null
  major: string | null
  grade: string | null
  goal: string | null
  interest: string[]
  skills: string[]
  learningStyle: string | null
  updatedBy: string | null
  createdAt?: string
  updatedAt?: string
}

/** 长期记忆类型（AI Campus Agent V1.0 Step 7） */
export type MemoryType = 'GOAL' | 'INTEREST' | 'ABILITY' | 'HABIT' | 'PREFERENCE'

/** 长期记忆：从对话提炼或设置页手动维护的跨天有效事实 */
export interface Memory {
  id: number
  type: MemoryType
  content: string
  /** 1=随口一提，5=核心目标 */
  importance: number
  /** ACTIVE=参与 AI 上下文；SUPERSEDED=已归档 */
  status: 'ACTIVE' | 'SUPERSEDED'
  /** AI=对话提炼，USER=手动添加 */
  source: 'AI' | 'USER'
  sourceRef: string | null
  createdAt?: string
  updatedAt?: string
}

/** 设置页记忆列表返回体；injected 是真正会进入 AI 上下文的条数 */
export interface MemoryList {
  items: Memory[]
  total: number
  injected: number
  limit: number
}

/** 新增/编辑记忆的请求体；type 与 importance 可省略 */
export interface MemoryPayload {
  type?: MemoryType
  content: string
  importance?: number
}

/**
 * AI Dashboard 聚合数据（AI Campus Agent V1.0 Step 5）。
 * 一次请求返回首页所需的全部信息；planSummary 为 Step 6「AI 每日计划」占位。
 */
export interface DashboardData {  /** 聚合日期（用户请求的 date，缺省为今天） */
  date: string
  /** 档案姓名；未建档为 null（显示「你好，同学」并引导填写） */
  greetingName: string | null
  profilePresent: boolean
  profile: StudentProfile | null
  /** 今日课程（星期 + 教学周双命中） */
  todayCourses: Course[]
  /** 今日任务：未完成且（今天截止 / 已逾期 / 无截止） */
  todayTasks: Task[]
  /** 48 小时内截止的未完成任务（不含已逾期） */
  upcomingDeadlines: Task[]
  /** 今天起 14 天内的考试 */
  upcomingExams: Exam[]
  /** 规则计算的今日重点（确定性，不烧 token） */
  todayHighlights: string[]
  /** 已生成的当日计划（未生成为 null） */
  plan: DailyPlan | null
  /** 计划摘要（plan.summary 的便捷字段，无计划时 null） */
  planSummary: string | null
}
