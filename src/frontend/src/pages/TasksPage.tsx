import { Tabs } from 'antd'
import { useSearchParams } from 'react-router-dom'
import FocusPage from './FocusPage'
import TodosPage from './TodosPage'
import RecurringTodoPanel from '../components/RecurringTodoPanel'
import '../tasks-page.css'

export default function TasksPage() {
  const [search, setSearch] = useSearchParams()
  const view = search.get('view')
  const active = view === 'all' || view === 'recurring' ? view : 'today'

  return (
    <div className="tasks-page">
      <Tabs
        className="tasks-views"
        activeKey={active}
        onChange={(key) => setSearch((previous) => {
          const next = new URLSearchParams(previous)
          next.set('view', key)
          return next
        })}
        tabBarExtraContent={{ left: <h1 className="tasks-title">任务</h1> }}
        items={[
          {
            key: 'today',
            label: '今日',
            forceRender: true,
            children: <FocusPage embedded />,
          },
          { key: 'all', label: '全部', children: <TodosPage embedded /> },
          { key: 'recurring', label: '循环', children: <RecurringTodoPanel /> },
        ]}
      />
    </div>
  )
}
