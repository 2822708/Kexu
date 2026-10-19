import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { mobilePwa } from './src/pwa/buildPlugin.mjs'

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, '.', 'VITE_').VITE_DEV_API_TARGET || 'http://localhost:8080'
  const proxy = { '/api': { target, changeOrigin: true } }
  return {
    plugins: [react(), ...(mode === 'mobile' ? [mobilePwa()] : [])],
    server: {
      port: 5173,
      proxy,
    },
    preview: { proxy },
    build: {
      // antd 作为独立 vendor chunk（约 1.1MB / gzip 360KB），单独缓存
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // 拆分体积较大的第三方库，改善首屏加载与缓存命中
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            antd: ['antd', '@ant-design/icons'],
          },
        },
      },
    },
  }
})
