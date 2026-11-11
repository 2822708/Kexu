import { LOCAL_MODE } from './local/mode'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { BootError, BootLoading } from './components/BootScreen'
import SwipePager from './components/SwipePager'
import DeviceConnectionPage from './pages/DeviceConnectionPage'
import { useApp } from './store/AppContext'

const SWIPE_ROUTES = ['/timetable', '/tasks', '/ai', '/settings'] as const

const TimetablePage = lazy(() => import('./pages/TimetablePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const AiChatPage = lazy(() => import('./pages/AiChatPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UserManualPage = lazy(() => import('./pages/UserManualPage'))
const WidgetPreviewPage = lazy(() => import('./pages/WidgetPreviewPage'))

export default function App() {
  return (
    <Suspense fallback={<BootLoading waitingForPage />}>
      <AppRoutes />
    </Suspense>
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
    if (!connectionError) return <BootLoading />
    return (
      <BootError
        title="本机数据暂时无法打开"
        description={connectionError}
        onRetry={() => void reconnect()}
      />
    )
  }
  if (!ready || !authed) {
    return <DeviceConnectionPage />
  }

  if (LOCAL_MODE && widgetRoute) return <Navigate to="/tasks" replace />

  if (widgetRoute) {
    return <WidgetPreviewPage />
  }

  return (
    <AppLayout>
      <SwipePager
        routes={SWIPE_ROUTES}
        renderPage={(pageLocation) => (
          <Suspense fallback={null}>
            <MainRoutes location={pageLocation} />
          </Suspense>
        )}
      >
        <MainRoutes location={location} />
      </SwipePager>
    </AppLayout>
  )
}

function MainRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/timetable" element={<TimetablePage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/todos" element={<TaskRedirect view="all" />} />
      <Route path="/focus" element={<TaskRedirect view="today" />} />
      <Route path="/ai" element={<AiChatPage />} />
      <Route path="/manual" element={<UserManualPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/timetable" replace />} />
    </Routes>
  )
}

function TaskRedirect({ view }: { view: 'today' | 'all' }) {
  const location = useLocation()
  const search = new URLSearchParams(location.search)
  search.set('view', view)
  return <Navigate to={{ pathname: '/tasks', search: `?${search}`, hash: location.hash }} replace />
}
