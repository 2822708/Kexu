import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DeviceConnectionPage from './pages/DeviceConnectionPage'
import DashboardPage from './pages/DashboardPage'
import TimetablePage from './pages/TimetablePage'
import TodosPage from './pages/TodosPage'
import AiChatPage from './pages/AiChatPage'
import SettingsPage from './pages/SettingsPage'
import StatsPage from './pages/StatsPage'
import UserManualPage from './pages/UserManualPage'
import WidgetPreviewPage from './pages/WidgetPreviewPage'
import { useApp } from './store/AppContext'
import { VoiceAssistantProvider } from './store/VoiceAssistantContext'

export default function App() {
  const { ready, authed } = useApp()
  const location = useLocation()
  const widgetRoute = location.pathname.startsWith('/widget')
  const explicitWidgetKey = (
    new URLSearchParams(location.hash.replace(/^#/, '')).get('key') ??
    new URLSearchParams(location.search).get('key')
  )?.trim()

  if (widgetRoute && explicitWidgetKey) {
    return <WidgetPreviewPage />
  }

  if (!ready || !authed) {
    return <DeviceConnectionPage />
  }

  if (widgetRoute) {
    return <WidgetPreviewPage />
  }

  return (
    // 语音助手挂在路由外层：录音途中切页面不应该被打断
    <VoiceAssistantProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/ai" element={<AiChatPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/manual" element={<UserManualPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </VoiceAssistantProvider>
  )
}
