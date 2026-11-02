/**
 * PWA 与打包外壳共用本地存储；旧的 Java 部署使用 REST 适配器。
 * 判定规则集中在 `src/app-mode.ts`，这里只负责把 Vite 环境注入进去。
 */
import { resolveAppMode } from '../app-mode'

export const APP_MODE = resolveAppMode({
  viteMode: import.meta.env.MODE,
  localData: import.meta.env.VITE_LOCAL_DATA as string | undefined,
})

export const NATIVE_SHELL = APP_MODE.source === 'shell'
export const LOCAL_MODE = APP_MODE.id === 'local'
