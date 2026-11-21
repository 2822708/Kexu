import { DownOutlined } from '@ant-design/icons'
import { Tabs } from 'antd'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FocusPage from './FocusPage'
import TodosPage from './TodosPage'
import RecurringTodoPanel from '../components/RecurringTodoPanel'
import { LOCAL_MODE } from '../local/mode'
import '../tasks-page.css'

export default function TasksPage() {
  const [search, setSearch] = useSearchParams()
  const [dateHeadingTarget, setDateHeadingTarget] = useState<HTMLDivElement | null>(null)
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
          <div className="tasks-view-picker">
            <select aria-label="任务视图" value={active} onChange={(event) => openView(event.target.value)}>
              <option value="today">今日任务</option>
              <option value="all">全部任务</option>
              <option value="recurring">循环任务</option>
            </select>
            <DownOutlined aria-hidden />
          </div>
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
