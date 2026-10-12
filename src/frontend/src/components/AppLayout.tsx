import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { message, Select, Tag, Tooltip } from 'antd'
import {
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DesktopOutlined,
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
import { useVisualViewport } from '../hooks/useVisualViewport'

const NAV_ITEMS = [
  { key: '/timetable', icon: <CalendarOutlined />, label: '课表' },
  { key: '/focus', icon: <FieldTimeOutlined />, label: '专注' },
  { key: '/todos', icon: <CheckSquareOutlined />, label: '待办' },
  { key: '/ai', icon: <MessageOutlined />, label: 'AI 助手' },
  { key: '/manual', icon: <BookOutlined />, label: '用户手册' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  useVisualViewport()
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, toggle } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => setSidebarOpen(false), [location.pathname])
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
    todos,
    courses,
  } = useApp()

  const weekInfo = useMemo(() => {
    if (!activeSchedule) return null
    return formatWeekInfo(activeSchedule.periodStartDate, activeSchedule.periodEndDate)
  }, [activeSchedule])

  const selectedKey =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.key))?.key ?? '/timetable'

  const activeTodos = todos.filter((t) => !t.completed).length

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="app-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button
            type="button"
            className="icon-btn-round topbar-menu-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title="菜单"
            aria-label="打开菜单"
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
          >
            <MenuOutlined />
          </button>
          <div className="app-topbar-title" onClick={() => navigate('/timetable')}>
            大切课程表
          </div>
        </div>
        <div className="app-topbar-actions">
          {weekInfo && (
            <Tag style={{ background: 'transparent', color: '#f0ebe4', border: '1px solid #888' }}>
              {weekInfo}
            </Tag>
          )}
          <Tooltip title="立即同步">
            <button
              type="button"
              className="icon-btn-round"
              aria-label="刷新数据"
              disabled={loading}
              onClick={() => refreshAll().catch(() => message.error('同步失败，请稍后重试'))}
              style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}
            >
              <ReloadOutlined spin={loading} />
            </button>
          </Tooltip>
          <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <button
              type="button"
              aria-label={mode === 'dark' ? '切换到亮色' : '切换到暗色'}
              className="icon-btn-round"
              onClick={toggle}
            >
              {mode === 'dark' ? '☀' : '☾'}
            </button>
          </Tooltip>
          <Tooltip title="本机已自动连接；原有账户会继续使用。设备范围和连接说明见用户手册。">
            <div
              className="icon-btn-round device-connection-badge"
              style={{ width: 'auto', padding: '0 12px', fontSize: 13 }}
            >
              <DesktopOutlined /> {label || '本机空间'} · 已连接
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="app-body">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="关闭菜单"
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar */}
        <aside id="app-sidebar" className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-avatar">
            <div className="sidebar-avatar-img">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="avatar"
                  style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                'T'
              )}
            </div>
            <div className="sidebar-avatar-name">{label || 'Tangent'}</div>
          </div>

          <div className="sidebar-divider" />

          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                to={item.key}
                className={`sidebar-nav-item ${selectedKey === item.key ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                {selectedKey === item.key ? `✦ ${item.label}` : item.label}
              </Link>
            ))}
          </nav>

          <div className="sidebar-divider" />

          <div className="sidebar-stats">
            <div className="sidebar-stats-title">ฅ^•ﻌ•^ฅ 统计</div>
            <div className="sidebar-stats-item">课程: {courses.length} 门</div>
            <div className="sidebar-stats-item">待办: {activeTodos} 条</div>
            <div className="sidebar-stats-item">课表: {schedules.length} 个</div>
          </div>

          <div className="sidebar-divider" />

          {schedules.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="sidebar-stats-title">课表切换</div>
              <Select
                aria-label="当前课表"
                value={activeScheduleId ?? undefined}
                onChange={(v) => setActiveScheduleId(v)}
                placeholder="选择课表"
                style={{ width: '100%' }}
                options={schedules.map((s) => ({ value: s.id, label: s.name }))}
                notFoundContent="暂无课表"
                size="small"
              />
            </div>
          )}

          <div className="sidebar-divider" />

          <div className="sidebar-kaomoji">૮₍◜ෆ◝.₎ა</div>
        </aside>

        {/* Main content */}
        <main className="app-content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="手机主导航">
        {NAV_ITEMS.slice(0, 4).map((item) => (
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
        <button
          type="button"
          aria-label="更多功能与课表切换"
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <MenuOutlined />
          <span>更多</span>
        </button>
      </nav>
      {/* Footer */}
      <footer className="app-footer">
        <span className="app-footer-text">© 2026 大切课程表 | 正切的课程表</span>
        <span className="app-footer-text">˶ˊᜊˋ˶</span>
      </footer>
      <QuickImportWidget />
    </div>
  )
}
