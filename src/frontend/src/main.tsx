import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import App from './App'
import { AppProvider } from './store/AppContext'
import { FontProvider } from './store/FontContext'
import { ThemeProvider } from './theme'
import { RewardsProvider } from './store/RewardsContext'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import './index.css'
import './styles/bright.css'

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FontProvider>
      <ThemeProvider>
        <AntApp>
          <BrowserRouter>
            <AppProvider>
              <RewardsProvider>
                <App />
              </RewardsProvider>
            </AppProvider>
          </BrowserRouter>
        </AntApp>
      </ThemeProvider>
    </FontProvider>
  </React.StrictMode>,
)
