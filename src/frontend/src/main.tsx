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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <FontProvider>
        <AccentProvider>
          <ThemeProvider>
            <AntApp>
              <BrowserRouter>
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
