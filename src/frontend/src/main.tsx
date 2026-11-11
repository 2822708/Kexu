import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import App from './App'
import { BootErrorBoundary } from './components/BootScreen'
import { AppProvider } from './store/AppContext'
import { FontProvider } from './store/FontContext'
import { AccentProvider } from './store/AccentContext'
import { ThemeProvider } from './theme'
import { APP_MODE } from './local/mode'
import './index.css'
import './mobile.css'

if (import.meta.env.DEV) {
  console.info('[kexu] ' + APP_MODE.label + '（' + APP_MODE.source + '）：' + APP_MODE.hint)
}

// 子路径部署（如 GitHub Pages 的 /Kexu/）时，路由必须与 Vite base 保持一致。
const routerBase = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <FontProvider>
        <AccentProvider>
          <ThemeProvider>
            <AntApp>
              <BrowserRouter basename={routerBase}>
                <AppProvider>
                  <App />
                </AppProvider>
              </BrowserRouter>
            </AntApp>
          </ThemeProvider>
        </AccentProvider>
      </FontProvider>
    </BootErrorBoundary>
  </React.StrictMode>,
)
