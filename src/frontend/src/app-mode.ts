/**
 * 运行模式判定：整个前端只有这一处决定“要不要后端”。
 *
 * 之前 `LOCAL_MODE` 由 `import.meta.env.MODE` 和 `VITE_LOCAL_DATA` 在各处拼接，
 * 忘记设置标志位时会静默落到服务器模式，并在连不上 8080 时只显示“暂时无法连接”。
 * 现在把判定收敛成纯函数，便于单元测试与构建期断言。
 */

export type AppModeId = 'local' | 'server'

export type AppModeSource = 'shell' | 'mobile' | 'local-mode' | 'env-flag' | 'default'

export interface AppModeInfo {
  id: AppModeId
  source: AppModeSource
  label: string
  /** 该模式是否必须有一个可访问的后端。 */
  needsBackend: boolean
  /** 启动日志与出错提示共用的说明。 */
  hint: string
}

export interface AppModeInput {
  viteMode?: string
  localData?: string
}

const LOCAL_HINT = '数据保存在本机 IndexedDB，不访问后端。'
const SERVER_HINT =
  '需要 Java 后端：cd src/backend 后运行 ./mvnw spring-boot:run（Windows 用 mvnw.cmd）；只想看界面可改用 npm run dev:local。'

export function resolveAppMode(input: AppModeInput): AppModeInfo {
  const mode = input.viteMode ?? ''

  if (mode === 'shell') {
    return { id: 'local', source: 'shell', label: '本地模式（原生外壳）', needsBackend: false, hint: LOCAL_HINT }
  }
  if (mode === 'mobile') {
    return { id: 'local', source: 'mobile', label: '本地模式（PWA）', needsBackend: false, hint: LOCAL_HINT }
  }
  if (mode === 'localdata') {
    return { id: 'local', source: 'local-mode', label: '本地模式', needsBackend: false, hint: LOCAL_HINT }
  }
  if (isTruthyFlag(input.localData)) {
    return { id: 'local', source: 'env-flag', label: '本地模式', needsBackend: false, hint: LOCAL_HINT }
  }
  return { id: 'server', source: 'default', label: '服务器模式', needsBackend: true, hint: SERVER_HINT }
}

/**
 * 环境变量布尔值按常见约定解析：true/1/yes/on，大小写不敏感。
 * 与直接 `=== 'true'` 相比更宽容，避免 `TRUE` 被误判成服务器模式。
 */
export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** 构建期断言：两种模式都不能被环境变量意外改写。 */
export function assertBuildMode(input: {
  viteMode?: string
  localData?: string
  apiBase?: string
}): string | null {
  const appMode = resolveAppMode(input)

  if (appMode.id === 'local' && appMode.source === 'env-flag') {
    return (
      '构建环境带有 VITE_LOCAL_DATA=true，但当前是普通网页构建，产物会变成不需要后端的本地模式。' +
      '请移除该变量；需要本地网页构建请运行 npm run build:localdata，PWA 请用 npm run build:mobile。'
    )
  }

  if (appMode.id !== 'server') return null
  const base = input.apiBase ?? ''
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^/]+\.localhost)(:\d+)?/i.test(base)) {
    return (
      `服务器模式的构建不能把 VITE_API_BASE 指向本机开发地址（当前 ${base}）。` +
      '部署到独立域名时请改为同源 /api 或真实服务地址；本地联调请改用 npm run dev:local。'
    )
  }
  return null
}
