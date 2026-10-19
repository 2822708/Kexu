import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { message, Select, Tag, Tooltip } from 'antd'
import {
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  FieldTimeOutlined,
  MenuOutlined,
  MessageOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useApp } from '../store/AppContext'
import { useTheme } from '../theme'
import { formatWeekInfo } from '../utils/schedule'
import QuickImportWidget from './QuickImportWidget'
import PwaStatus from './PwaStatus'
import { useVisualViewport } from '../hooks/useVisualViewport'
import { LOCAL_MODE } from '../local/mode'
import '../app-shell.css'

const NAV_ITEMS = [
  { key: '/timetable', icon: <CalendarOutlined />, label: '课表' },
  { key: '/focus', icon: <FieldTimeOutlined />, label: '今日' },
  { key: '/todos', icon: <CheckSquareOutlined />, label: '待办' },
  { key: '/ai', icon: <MessageOutlined />, label: '助手' },
  { key: '/settings', icon: <SettingOutlined />, label: '我的' },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  useVisualViewport()
  const location = useLocation()
  const { mode, toggle } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => setSidebarOpen(false), [location.pathname])
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])
  useEffect(() => {
    if (!sidebarOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [sidebarOpen])
  const {
    label,
    avatarUrl,
    schedules,
    activeScheduleId,
    activeSchedule,
    setActiveScheduleId,
    refreshAll,
    loading,
  } = useApp()

  const weekInfo = useMemo(() => {
    if (!activeSchedule) return null
    return formatWeekInfo(activeSchedule.periodStartDate, activeSchedule.periodEndDate)
  }, [activeSchedule])

  const activeNav = NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))
  const selectedKey = activeNav?.key
  const isManual = location.pathname.startsWith('/manual')

  return (
    <div className="app-shell">
      <a className="app-skip-link" href="#app-main">跳到主要内容</a>
      <header className="app-topbar">
        <div className="app-topbar-leading">
          <button
            type="button"
            className="icon-btn-round topbar-menu-btn"
            onClick={() => setSidebarOpen((open) => !open)}
            title="菜单与课表切换"
            aria-label={sidebarOpen ? '关闭菜单' : '打开菜单与课表切换'}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            <MenuOutlined />
          </button>
          <Link to="/timetable" className="app-brand" aria-label="课序，返回课表">
            <span className="app-brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}pwa/icon.svg`} alt="" /></span>
            <span className="app-brand-copy">
              <span className="app-topbar-title">课序</span>
              <span className="app-brand-subtitle">课表 · 待办 · 专注</span>
            </span>
          </Link>
          <span className="app-current-page">{isManual ? '使用帮助' : activeNav?.label}</span>
        </div>
        <div className="app-topbar-actions">
          {weekInfo && <Tag className="app-week-tag">{weekInfo}</Tag>}
          <PwaStatus />
          <Tooltip title={LOCAL_MODE ? '重新读取本机数据' : '立即刷新'}>
            <button
              type="button"
              className="icon-btn-round"
              aria-label="刷新数据"
              disabled={loading}
              onClick={() =>
                refreshAll().catch(() =>
                  message.error(
                    LOCAL_MODE ? '读取本机数据失败，请稍后重试' : '刷新失败，请稍后重试',
                  ),
                )
              }
            >
              <ReloadOutlined spin={loading} />
            </button>
          </Tooltip>
          <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <button
              type="button"
              aria-label={mode === 'dark' ? '切换到亮色' : '切换到暗色'}
              className="icon-btn-round theme-toggle"
              onClick={toggle}
            >
              <span aria-hidden="true">{mode === 'dark' ? '☀' : '☾'}</span>
            </button>
          </Tooltip>
        </div>
      </header>

      <div className="app-body">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="关闭菜单"
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside id="app-sidebar" className={`app-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="工作空间">
          <div className="sidebar-profile">
            <div className="sidebar-avatar-img">
              {avatarUrl ? <img src={avatarUrl} alt="个人头像" /> : <span aria-hidden="true">{(label || '我').slice(0, 1)}</span>}
            </div>
            <div className="sidebar-profile-copy">
              <div className="sidebar-avatar-name">{label || '我的空间'}</div>
              <div className="sidebar-profile-caption">{LOCAL_MODE ? '数据留在本机' : '我的工作空间'}</div>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                to={item.key}
                className={`sidebar-nav-item${selectedKey === item.key ? ' active' : ''}`}
                aria-current={selectedKey === item.key ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}<span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {schedules.length > 0 && (
            <div className="sidebar-schedule-switch">
              <label className="sidebar-section-label" htmlFor="sidebar-schedule">当前课表</label>
              <Select
                id="sidebar-schedule"
                aria-label="当前课表"
                value={activeScheduleId ?? undefined}
                onChange={(value) => setActiveScheduleId(value)}
                placeholder="选择课表"
                options={schedules.map((schedule) => ({ value: schedule.id, label: schedule.name }))}
                notFoundContent="暂无课表"
              />
              {activeSchedule && <span className="sidebar-schedule-dates">{activeSchedule.periodStartDate} — {activeSchedule.periodEndDate}</span>}
            </div>
          )}

          <div className="sidebar-bottom">
            <Link to="/manual" className={`sidebar-nav-item${isManual ? ' active' : ''}`} aria-current={isManual ? 'page' : undefined} onClick={() => setSidebarOpen(false)}>
              <BookOutlined /><span>使用帮助</span>
            </Link>
            <p className="sidebar-data-hint">{LOCAL_MODE ? '课表与待办先保存在此设备，云端只保存加密快照。' : '在一个空间里，安排好每一天。'}</p>
          </div>
        </aside>

        <main ref={contentRef} id="app-main" className="app-content" tabIndex={-1}>{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="手机主导航">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            to={item.key}
            aria-current={selectedKey === item.key ? 'page' : undefined}
            className={selectedKey === item.key ? 'active' : ''}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      {!location.pathname.startsWith('/ai') && !location.pathname.startsWith('/focus') && <QuickImportWidget />}
    </div>
  )
}
