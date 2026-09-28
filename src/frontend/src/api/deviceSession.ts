import { authApi } from './index'
import { ApiError, getApiKey, setApiKey } from './client'
import type { AuthVerifyResponse } from '../types'

export const DEVICE_KEY_STORAGE = 'timetable.deviceKey'
const DEVICE_KEY_PATTERN = /^device_[A-Za-z0-9_-]{43}$/
const LOCK_NAME = 'timetable.device-session'
let pendingConnection: Promise<AuthVerifyResponse> | null = null

function getOrCreateDeviceKey(existingKey: string | null): string {
  // Save before the first request so a timeout or page reload never creates another identity.
  if (existingKey && DEVICE_KEY_PATTERN.test(existingKey)) {
    localStorage.setItem(DEVICE_KEY_STORAGE, existingKey)
    return existingKey
  }
  const saved = localStorage.getItem(DEVICE_KEY_STORAGE)
  if (saved) {
    if (!DEVICE_KEY_PATTERN.test(saved)) {
      throw new Error('本机连接信息无法读取，请恢复浏览器数据或联系管理员；已保留原有信息。')
    }
    return saved
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const key = `device_${token}`
  localStorage.setItem(DEVICE_KEY_STORAGE, key)
  return localStorage.getItem(DEVICE_KEY_STORAGE) ?? key
}

async function establishConnection(): Promise<AuthVerifyResponse> {
  const originalKey = getApiKey()
  let key = originalKey
  let result: AuthVerifyResponse | undefined
  if (key) {
    try {
      result = await authApi.verify(key)
    } catch (error) {
      // A transport error is never evidence that an identity is invalid.
      if (!(error instanceof ApiError) || error.code !== 401) throw error
    }
    if (!result?.valid && !DEVICE_KEY_PATTERN.test(key)) {
      throw new Error(
        '原有账户连接已失效，登录信息和数据归属已保留。请联系管理员恢复原有账户后重新连接。',
      )
    }
  }
  if (getApiKey() !== originalKey) {
    throw new Error('本机连接信息已在其他窗口更新，请重新连接。')
  }
  if (!result?.valid) {
    key = getOrCreateDeviceKey(originalKey)
    result = await authApi.device(key)
    if (!result.valid) throw new Error('本机连接未获授权，请联系管理员后重新连接。')
    if (localStorage.getItem(DEVICE_KEY_STORAGE) !== key) {
      throw new Error('本机连接信息已在其他窗口更新，请重新连接。')
    }
  }
  if (!key || getApiKey() !== originalKey) {
    throw new Error('本机连接信息已在其他窗口更新，请重新连接。')
  }
  setApiKey(key, result.label, result.avatarUrl)
  return result
}

export function connectDevice(): Promise<AuthVerifyResponse> {
  if (pendingConnection) return pendingConnection
  // Web Locks serialize new-profile initialization across tabs; the synchronous storage
  // read/create above and the final identity checks also protect browsers without locks.
  const attempt = (async () => {
    if (navigator.locks) return await navigator.locks.request(LOCK_NAME, establishConnection)
    return await establishConnection()
  })()
  pendingConnection = attempt.finally(() => {
    pendingConnection = null
  })
  return pendingConnection
}
