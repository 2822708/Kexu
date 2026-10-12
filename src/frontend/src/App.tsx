import { lazy, Suspense } from 'react'
import { Spin } from 'antd'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import PwaStatus from './components/PwaStatus'
import DeviceConnectionPage from './pages/DeviceConnectionPage'
import { useApp } from './store/AppContext'

const TimetablePage = lazy(() => import('./pages/TimetablePage'))
const TodosPage = lazy(() => import('./pages/TodosPage'))
const FocusPage = lazy(() => import('./pages/FocusPage'))
const AiChatPage = lazy(() => import('./pages/AiChatPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UserManualPage = lazy(() => import('./pages/UserManualPage'))
const WidgetPreviewPage = lazy(() => import('./pages/WidgetPreviewPage'))

export default function App() {
  return (
    <>
      <PwaStatus />
      <Suspense
        fallback={
          <div className="app-loading-page">
            <Spin tip="正在打开页面…">
              <div style={{ height: 48 }} />
            </Spin>
          </div>
        }
      >
        <AppRoutes />
      </Suspense>
    </>
  )
}

function AppRoutes() {
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
