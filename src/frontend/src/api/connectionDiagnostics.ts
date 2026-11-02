import { APP_MODE } from '../local/mode'

/**
 * 把连接失败翻译成可执行的修复步骤。
 * 只对需要后端的模式追加排查建议；本地模式保持原始错误，避免误导。
 */
export function describeConnectionFailure(error: unknown, baseUrl: string): string {
  const reason = error instanceof Error ? error.message : String(error)
  if (!APP_MODE.needsBackend) return reason
  return [
    `请求地址：${baseUrl}`,
    `原因：${reason}`,
    '可以这样排查：',
    '1. 后端未启动：在 src/backend 运行 ./mvnw spring-boot:run（Windows 用 mvnw.cmd）',
    '2. 只想看界面：在 src/frontend 运行 npm run dev:local，数据保存在本机',
    '3. 后端在其他地址：设置 VITE_API_BASE 后重启开发服务器',
  ].join('\n')
}
