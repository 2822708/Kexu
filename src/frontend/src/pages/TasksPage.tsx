import { CheckOutlined, DownOutlined } from '@ant-design/icons'
import { Dropdown, Tabs } from 'antd'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FocusPage from './FocusPage'
import TodosPage from './TodosPage'
import RecurringTodoPanel from '../components/RecurringTodoPanel'
import { LOCAL_MODE } from '../local/mode'
import '../tasks-page.css'

const TASK_VIEWS = {
  today: '今日任务',
  all: '全部任务',
  recurring: '循环任务',
}

export default function TasksPage() {
  const [search, setSearch] = useSearchParams()
  const [dateHeadingTarget, setDateHeadingTarget] = useState<HTMLDivElement | null>(null)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const viewButton = useRef<HTMLButtonElement>(null)
  const view = search.get('view')
  const active = view === 'all' || view === 'recurring' ? view : 'today'

  function openView(key: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous)
      next.set('view', key)
      return next
    })
  }

  return (
    <div className={LOCAL_MODE && active === 'today' ? 'tasks-page tasks-page--daily' : 'tasks-page'}>
      {LOCAL_MODE ? (
        <header className="tasks-page-heading tasks-page-heading--compact">
          <h1 className="tasks-sr-title">任务</h1>
          <Dropdown
            trigger={['click']}
            placement="bottomLeft"
            rootClassName="tasks-view-menu"
            autoFocus
            open={viewMenuOpen}
            onOpenChange={setViewMenuOpen}
            menu={{
              items: Object.entries(TASK_VIEWS).map(([key, label]) => ({
                key,
                role: 'menuitemradio',
                'aria-checked': active === key,
                label: (
                  <span className="tasks-view-option">
                    {label}
                    {active === key && <CheckOutlined aria-hidden />}
                  </span>
                ),
              })),
              onClick: ({ key, domEvent }) => {
                domEvent.preventDefault()
                setViewMenuOpen(false)
                viewButton.current?.focus({ preventScroll: true })
                if (key !== active) openView(key)
              },
            }}
          >
            <button
              ref={viewButton}
              type="button"
              className="tasks-view-picker"
              aria-label={`任务视图：${TASK_VIEWS[active]}`}
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
            >
              {TASK_VIEWS[active]}
              <DownOutlined aria-hidden />
            </button>
          </Dropdown>
          <div className="tasks-date-slot" ref={setDateHeadingTarget} />
        </header>
      ) : (
        <header className="tasks-page-heading">
          <h1 className="tasks-title">任务</h1>
        </header>
      )}
      <Tabs
        className="tasks-views"
        activeKey={active}
        onChange={openView}
        renderTabBar={LOCAL_MODE ? (props, DefaultTabBar) => (
          <div hidden><DefaultTabBar {...props} /></div>
        ) : undefined}
        items={[
          {
            key: 'today',
            label: '今日',
            forceRender: true,
            children: (
              <FocusPage embedded dateHeadingTarget={active === 'today' ? dateHeadingTarget : null} />
            ),
          },
          { key: 'all', label: '全部', children: <TodosPage embedded /> },
          { key: 'recurring', label: '循环', children: <RecurringTodoPanel /> },
        ]}
      />
    </div>
  )
}
