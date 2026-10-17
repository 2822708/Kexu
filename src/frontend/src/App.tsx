import { useCallback, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DeviceConnectionPage from './pages/DeviceConnectionPage'
import DashboardPage from './pages/DashboardPage'
import TimetablePage from './pages/TimetablePage'
import TodosPage from './pages/TodosPage'
import AiChatPage from './pages/AiChatPage'
import SettingsPage from './pages/SettingsPage'
import StatsPage from './pages/StatsPage'
import OnboardingPage from './pages/OnboardingPage'
import UserManualPage from './pages/UserManualPage'
import WidgetPreviewPage from './pages/WidgetPreviewPage'
import { useApp } from './store/AppContext'
import { VoiceAssistantProvider } from './store/VoiceAssistantContext'

/**
 * 功能说明页只看一次。
 *
 * 放在这里而不是 AppLayout 内部，是因为它不该带侧栏和浮球——
 * 首屏要的是「读完这页」，不是「开始操作」。
 */
function useOnboarded(): [boolean, () => void] {
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem('timetable.onboarded') === '1'
    } catch {
      return true // localStorage 不可用时不再拦路
    }
  })
  const markDone = useCallback(() => {
    setDone(true)
    try {
      localStorage.setItem('timetable.onboarded', '1')
    } catch {
      // 忽略：写不进去也只是下次再看一次
    }
  }, [])
  return [done, markDone]
}

export default function App() {
  const { ready, authed } = useApp()
  const location = useLocation()
  const [onboarded, markOnboarded] = useOnboarded()
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

  /*
   * 未看过说明页就先只看这一页，不带侧栏和浮球。
   *
   * 首次登录直接进首页是最差的首屏：课表空的、待办空的、AI 也没聊过，
   * 用户不知道自己该干什么。三分钟的说明页换来的是「知道往哪贴第一条通知」。
   */
  if (!onboarded) {
    return <OnboardingPage onDone={markOnboarded} />
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
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </VoiceAssistantProvider>
  )
}
