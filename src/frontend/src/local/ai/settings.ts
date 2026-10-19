/** Private AI connection settings. This key is deliberately outside the local snapshot database. */
export const AI_SETTINGS_KEY = 'tangent_private_ai_connection_v1'
export const AI_SETTINGS_EVENT = 'tangent-ai-settings-changed'

export interface AiConnectionSettings {
  endpoint: string
  model: string
  apiKey: string
  enabled: boolean
  allowContext: boolean
  visionEnabled: boolean
}

export const DEFAULT_AI_SETTINGS: AiConnectionSettings = {
  endpoint: '',
  model: '',
  apiKey: '',
  enabled: false,
  allowContext: false,
  visionEnabled: false,
}

/** Accept a base /v1 URL or the complete Chat Completions URL, never credentials in a URL. */
export function completionUrl(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint.trim())
  } catch {
    throw new Error('请填写完整的 AI 服务 HTTPS 地址')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('AI 地址必须使用 HTTPS；本机调试可使用 localhost HTTP')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('AI 地址不能包含账号、密钥、查询参数或片段')
  }
  if (url.pathname.includes('//')) throw new Error('AI 地址路径无效')
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.href
}

export function validateAiSettings(value: AiConnectionSettings): AiConnectionSettings {
  const endpoint = value.endpoint.trim()
  const model = value.model.trim()
  const apiKey = value.apiKey.trim()
  if (endpoint) completionUrl(endpoint)
  if (model.length > 200 || /[\r\n]/.test(model)) throw new Error('模型名称无效')
  if (apiKey.length > 2048 || /[\r\n]/.test(apiKey)) throw new Error('API Key 无效')
  if (value.enabled && (!endpoint || !model || !apiKey || !value.allowContext)) {
    throw new Error('启用前请填写地址、模型和 Key，并允许发送必要上下文')
  }
  return {
    endpoint,
    model,
    apiKey,
    enabled: value.enabled === true,
    allowContext: value.allowContext === true,
    visionEnabled: value.visionEnabled === true,
  }
}

export function getAiSettings(): AiConnectionSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_AI_SETTINGS }
    const item = raw as Record<string, unknown>
    return validateAiSettings({
      endpoint: typeof item.endpoint === 'string' ? item.endpoint : '',
      model: typeof item.model === 'string' ? item.model : '',
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
      enabled: item.enabled === true,
      allowContext: item.allowContext === true,
      visionEnabled: item.visionEnabled === true,
    })
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAiSettings(value: AiConnectionSettings): AiConnectionSettings {
  const settings = validateAiSettings(value)
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    throw new Error('浏览器未能保存 AI 设置，原配置保持不变')
  }
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT))
  return settings
}

export function clearAiSettings(): void {
  localStorage.removeItem(AI_SETTINGS_KEY)
  window.dispatchEvent(new Event(AI_SETTINGS_EVENT))
}

/** Same-tab saves and other-tab storage changes share one notification contract. */
export function subscribeAiSettings(listener: () => void): () => void {
  const changed = () => listener()
  const storage = (event: StorageEvent) => {
    if (event.key === AI_SETTINGS_KEY || event.key === null) listener()
  }
  window.addEventListener(AI_SETTINGS_EVENT, changed)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(AI_SETTINGS_EVENT, changed)
    window.removeEventListener('storage', storage)
  }
}
