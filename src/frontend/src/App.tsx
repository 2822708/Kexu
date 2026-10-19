import { LOCAL_MODE } from './local/mode'
import { lazy, Suspense } from 'react'
import { Alert, Button, Spin } from 'antd'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
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
  const { ready, authed, connectionError, reconnect } = useApp()
  const location = useLocation()
  const widgetRoute = location.pathname.startsWith('/widget')
  const explicitWidgetKey = (
    new URLSearchParams(location.hash.replace(/^#/, '')).get('key') ??
    new URLSearchParams(location.search).get('key')
  )?.trim()

  if (!LOCAL_MODE && widgetRoute && explicitWidgetKey) {
    return <WidgetPreviewPage />
  }

  if (LOCAL_MODE && (!ready || !authed)) {
    return (
      <div className="app-loading-page">
        {!ready || (!authed && !connectionError) ? (
          <Spin tip="正在打开本机数据">
            <div style={{ height: 48 }} />
          </Spin>
        ) : (
          <Alert
            type="error"
            showIcon
            message="本机数据暂时无法打开"
            description={connectionError ?? '请允许浏览器保存数据，并保留当前网站数据后重试。'}
            action={<Button onClick={() => void reconnect()}>重试</Button>}
          />
        )}
      </div>
    )
  }
  if (!ready || !authed) {
    return <DeviceConnectionPage />
  }

  if (LOCAL_MODE && widgetRoute) return <Navigate to="/focus" replace />

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
