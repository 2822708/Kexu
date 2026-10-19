import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { message, Select, Tag, Tooltip } from 'antd'
import {
  BookOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DesktopOutlined,
  HomeOutlined,
  InboxOutlined,
  MenuOutlined,
  MessageOutlined,
  ReloadOutlined,
  SettingOutlined,
  BarChartOutlined,
} from '@ant-design/icons'
import { useApp } from '../store/AppContext'
import { useTheme } from '../theme'
import { formatWeekInfo } from '../utils/schedule'
import QuickImportWidget from './QuickImportWidget'
import RewardsBadge from './RewardsBadge'
import RewardFloat from './RewardFloat'
import PwaInstallPrompt from './PwaInstallPrompt'

const NAV_ITEMS = [
  { key: '/', icon: <HomeOutlined />, label: '首页' },
  { key: '/timetable', icon: <CalendarOutlined />, label: '课表' },
  { key: '/todos', icon: <CheckSquareOutlined />, label: '待办' },
  { key: '/info', icon: <InboxOutlined />, label: '信息处理' },
  { key: '/ai', icon: <MessageOutlined />, label: 'AI 助手' },
  { key: '/stats', icon: <BarChartOutlined />, label: '用量统计' },
  { key: '/manual', icon: <BookOutlined />, label: '用户手册' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, toggle } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
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

  // 「/」会前缀匹配所有路径，必须精确比较；其余按前缀归属
  const selectedKey =
    NAV_ITEMS.find((item) =>
      item.key === '/' ? location.pathname === '/' : location.pathname.startsWith(item.key),
    )?.key ?? '/'

  const activeTodos = todos.filter((t) => !t.completed).length

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="app-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            className="icon-btn-round topbar-menu-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title="菜单"
          >
            <MenuOutlined />
          </div>
          <div className="app-topbar-title" onClick={() => navigate('/')}>
            AI 校园助手
          </div>
        </div>
        <div className="app-topbar-actions">
          {weekInfo && (
            <Tag
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '2px solid var(--border-dark)',
                borderRadius: 99,
                fontWeight: 800,
              }}
            >
              {weekInfo}
            </Tag>
          )}
          <RewardsBadge />
          <Tooltip title="立即同步">
            <div
              className="icon-btn-round"
              onClick={() => refreshAll().catch(() => message.error('同步失败，请稍后重试'))}
              style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}
            >
              <ReloadOutlined spin={loading} />
            </div>
          </Tooltip>
          <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <div className="icon-btn-round" onClick={toggle}>
              {mode === 'dark' ? '☀' : '☾'}
            </div>
          </Tooltip>
          <Tooltip title="本机已自动连接；原有账户会继续使用。设备范围和连接说明见用户手册。">
            <div
              className="icon-btn-round"
              style={{ width: 'auto', padding: '0 12px', fontSize: 13 }}
            >
              <DesktopOutlined /> {label || '本机空间'} · 已连接
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="app-body">
        {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
        {/* Sidebar */}
        <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>
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

      {/* Footer */}
      <footer className="app-footer">
        {/* 暂时不带品牌名：命名还没定，先不写死。 */}
        <span className="app-footer-text">© 2026 AI 校园助手</span>
        <span className="app-footer-text">˶ˊᜊˋ˶</span>
      </footer>
      <QuickImportWidget />
      <RewardFloat />
      <PwaInstallPrompt />
    </div>
  )
}
