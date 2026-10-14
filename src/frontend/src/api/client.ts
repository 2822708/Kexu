import type { ApiResponse } from '../types'

const API_KEY_STORAGE = 'timetable.apiKey'
const API_LABEL_STORAGE = 'timetable.apiLabel'
const API_AVATAR_STORAGE = 'timetable.apiAvatarUrl'

export const BASE_URL = import.meta.env.VITE_API_BASE ?? '/api'

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE)
}

export function setApiKey(key: string, label: string, avatarUrl?: string | null) {
  localStorage.setItem(API_KEY_STORAGE, key)
  localStorage.setItem(API_LABEL_STORAGE, label)
  if (avatarUrl) {
    localStorage.setItem(API_AVATAR_STORAGE, avatarUrl)
  } else {
    localStorage.removeItem(API_AVATAR_STORAGE)
  }
}

export function getLabel(): string {
  return localStorage.getItem(API_LABEL_STORAGE) ?? ''
}

export function getAvatarUrl(): string | null {
  return localStorage.getItem(API_AVATAR_STORAGE)
}

export function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE)
  localStorage.removeItem(API_LABEL_STORAGE)
  localStorage.removeItem(API_AVATAR_STORAGE)
}

export class ApiError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  apiKey?: string
  notifyUnauthorized?: boolean
  timeoutMs?: number
}

let unauthorizedHandler: ((key: string | null) => void) | null = null
let sessionRevision = 0

export function invalidateSessionRequests() {
  sessionRevision += 1
}

export function createUnauthorizedNotifier(key: string | null) {
  const revision = sessionRevision
  return () => {
    if (revision === sessionRevision) unauthorizedHandler?.(key)
  }
}

export function onUnauthorized(handler: (key: string | null) => void) {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, apiKey, notifyUnauthorized = true, timeoutMs } = options
  const key = apiKey ?? getApiKey()
  const notify = createUnauthorizedNotifier(key)

  const headers: Record<string, string> = {}
  if (key) headers['X-API-Key'] = key
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  let text: string
  const controller = timeoutMs ? new AbortController() : undefined
  const timer = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    })
    text = await res.text()
  } catch {
    throw new ApiError(0, '连接服务失败或等待超时，请检查网络和后端服务后重试。')
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }

  let payload: ApiResponse<T> | null = null
  if (text) {
    try {
      payload = JSON.parse(text) as ApiResponse<T>
    } catch {
      payload = null
    }
  }

  if (notifyUnauthorized && (res.status === 401 || payload?.code === 401)) {
    notify()
  }

  if (payload === null) {
    throw new ApiError(res.status, `请求失败 (HTTP ${res.status})`)
  }

  if (payload.code !== 200) {
    throw new ApiError(payload.code, payload.message || '请求失败')
  }

  return payload.data
}
