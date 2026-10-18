/**
 * PWA Service Worker 注册。
 *
 * 只在生产构建注册：dev server 的模块是即时编译的，SW 缓存它们只会
 * 造成「改了代码页面不更新」的幽灵 bug。
 *
 * 监听更新事件：新 SW 就绪时刷新一次，让用户尽快用上新壳——
 * 但不强制，正在填的表单不会被 refresh 打断（刷新只发生在
 * controllerchange 且页面空闲时，由 prompt 组件决定，这里只发信号）。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // 注册失败不影响任何功能：PWA 是渐进增强，不是硬依赖
      console.warn('[pwa] Service Worker 注册失败（不影响使用）:', error)
    })
  })
}
