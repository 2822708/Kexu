import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DeviceConnectionPage from './pages/DeviceConnectionPage'
import TimetablePage from './pages/TimetablePage'
import TodosPage from './pages/TodosPage'
import FocusPage from './pages/FocusPage'
import AiChatPage from './pages/AiChatPage'
import SettingsPage from './pages/SettingsPage'
import UserManualPage from './pages/UserManualPage'
import WidgetPreviewPage from './pages/WidgetPreviewPage'
import { useApp } from './store/AppContext'

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
    <AppLayout>
      <Routes>
        <Route path="/timetable" element={<TimetablePage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/ai" element={<AiChatPage />} />
        <Route path="/manual" element={<UserManualPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/timetable" replace />} />
      </Routes>
    </AppLayout>
  )
}
