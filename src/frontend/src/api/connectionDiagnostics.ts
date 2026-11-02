import { APP_MODE } from '../local/mode'

/**
 * 只有“连不上服务”才追加后端排查建议。
 * 凭据失效、权限不足、业务校验错误必须保留原文案：
 * 把“密钥无效”提示成“后端没启动、不如换本地模式”，会把用户推向另一个数据空间。
 */
const CONNECTIVITY_KINDS = new Set(['network', 'timeout', 'server'])

function failureKind(error: unknown): string | null {
  if (error && typeof error === 'object' && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind
    return typeof kind === 'string' ? kind : null
  }
  return null
}

export function describeConnectionFailure(error: unknown, baseUrl: string): string {
  const reason = error instanceof Error ? error.message : String(error)
  if (!APP_MODE.needsBackend) return reason
  if (!CONNECTIVITY_KINDS.has(failureKind(error) ?? '')) return reason
  return [
    `请求地址：${baseUrl}`,
    `原因：${reason}`,
    '可以这样排查：',
    '1. 后端未启动：在 src/backend 运行 ./mvnw spring-boot:run（Windows 用 mvnw.cmd）',
    '2. 只想看界面：在 src/frontend 运行 npm run dev:local，数据保存在本机',
    '3. 后端在其他地址：设置 VITE_API_BASE 后重启开发服务器',
  ].join('\n')
}
