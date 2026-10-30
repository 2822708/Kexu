import { completionUrl, type AiConnectionSettings } from './settings'

export const CUSTOM_AI_PROVIDER = 'custom'
export const CUSTOM_AI_MODEL = 'custom'

export interface AiProviderPreset {
  id: string
  label: string
  endpoint: string
  models: ReadonlyArray<{ id: string; label: string }>
  keyUrl: string
  docsUrl: string
  note?: string
}

/** Official Chat Completions endpoints and model IDs reviewed on 2026-10-30.
 * Only explicit save/test actions use these values; browsing presets makes no request.
 */
export const AI_PROVIDER_PRESETS: ReadonlyArray<AiProviderPreset> = [
  {
    id: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
  },
  {
    id: 'qwen', label: '阿里云百炼 · 千问（北京）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-plus', label: '千问 Plus' },
      { id: 'qwen3.8-max', label: '千问 3.8 Max' },
    ],
    keyUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    note: '请选择北京地域的 API Key。其他地域或业务空间专属地址，可选“其他服务”填写。',
  },
  {
    id: 'kimi', label: 'Kimi · 月之暗面', endpoint: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' },
      { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro 高速版' },
    ],
    keyUrl: 'https://platform.kimi.com/docs/get-api-key',
    docsUrl: 'https://platform.kimi.com/docs/models',
  },
  {
    id: 'zhipu', label: '智谱 · GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash' },
      { id: 'glm-5.3', label: 'GLM-5.3' },
    ],
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction',
    note: '这里使用标准 API；Coding 套餐的专用接口请通过“其他服务”配置。',
  },
  {
    id: 'siliconflow', label: '硅基流动 · SiliconFlow', endpoint: 'https://api.siliconflow.cn/v1',
    models: [{ id: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash' }],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    docsUrl: 'https://docs.siliconflow.cn/docs/api/chat-completions-post',
  },
  {
    id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
  },
]

export function sameAiEndpoint(first: string, second: string): boolean {
  if (!first.trim() || !second.trim()) return false
  try {
    return completionUrl(first) === completionUrl(second)
  } catch {
    return false
  }
}

export function findAiProvider(endpoint: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((provider) => sameAiEndpoint(endpoint, provider.endpoint))
}

/** Retain unknown and older model names; choosing presets never migrates private settings. */
export function initialAiSelection(saved: AiConnectionSettings) {
  const hasSavedConnection = !!(saved.endpoint || saved.model || saved.apiKey)
  const provider = hasSavedConnection ? findAiProvider(saved.endpoint) : AI_PROVIDER_PRESETS[0]
  const model = hasSavedConnection ? saved.model : provider!.models[0].id
  return {
    providerId: provider?.id ?? CUSTOM_AI_PROVIDER,
    endpoint: hasSavedConnection ? saved.endpoint : provider!.endpoint,
    model,
    modelChoice: provider?.models.some((item) => item.id === model) ? model : CUSTOM_AI_MODEL,
  }
}

/** Empty input can retain a key only for the exact saved completion destination. */
export function aiDraftKey(endpoint: string, input: string, saved: AiConnectionSettings): string {
  return input.trim() || (sameAiEndpoint(endpoint, saved.endpoint) ? saved.apiKey : '')
}
