/**
 * 传输层错误分类。
 *
 * 业务校验错误（4xx + 明确 code）保持原样交给调用方；
 * 网络、超时、5xx 这类“不是用户操作错”的失败统一归类，
 * 让界面可以给出可执行提示，而不是直接抛原始错误。
 */

export type ApiFailureKind = 'timeout' | 'network' | 'auth' | 'forbidden' | 'server' | 'client' | 'unknown'

export interface ApiFailure {
  kind: ApiFailureKind
  /** 同一请求重试是否可能成功。 */
  retryable: boolean
  status: number | null
  message: string
}

const SERVER_MESSAGE = '服务暂时不可用，请稍后重试'
const AUTH_MESSAGE = '登录状态已失效，请重新连接'
const NETWORK_MESSAGE = '连接服务失败或等待超时，请检查网络和后端服务后重试'

export function classifyApiFailure(input: {
  status?: number | null
  aborted?: boolean
  message?: string
}): ApiFailure {
  const status = input.status ?? null
  const message = input.message

  if (input.aborted) {
    return { kind: 'timeout', retryable: true, status, message: NETWORK_MESSAGE }
  }
  if (status === null || status === 0) {
    return { kind: 'network', retryable: true, status, message: NETWORK_MESSAGE }
  }
  if (status === 401) {
    return { kind: 'auth', retryable: false, status, message: AUTH_MESSAGE }
  }
  if (status === 403) {
    return { kind: 'forbidden', retryable: false, status, message: '当前账号没有执行该操作的权限' }
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: 'server', retryable: true, status, message: SERVER_MESSAGE }
  }
  if (status >= 400) {
    return { kind: 'client', retryable: false, status, message: message ?? `请求失败 (HTTP ${status})` }
  }
  return { kind: 'unknown', retryable: false, status, message: message ?? `请求失败 (HTTP ${status})` }
}

/** 5xx 且响应体不是 JSON 时，用统一文案替换原始 HTTP 码，便于用户理解。 */
export function fallbackMessageForStatus(status: number): string {
  return classifyApiFailure({ status }).message
}
