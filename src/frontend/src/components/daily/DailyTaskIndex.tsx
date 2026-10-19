import { Button, Empty, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useDailyWorkspace } from '../../hooks/useDailyWorkspace'
import { nowLocalDateTime } from '../../local/domain'
import '../../daily-task.css'

export default function DailyTaskIndex() {
  const navigate = useNavigate()
  const { workspace, error } = useDailyWorkspace(nowLocalDateTime().slice(0, 10))
  if (!workspace) return error ? <p role="alert">{error}</p> : <Spin />
  const tasks = workspace.unfinishedEntries
    .filter((entry) => entry.kind === 'dayTask')
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))
  return (
    <div>
      <p className="daily-muted">未处理的临时日任务保留在原计划日，打开后可明确调整。</p>
      {!tasks.length ? (
        <Empty description="没有未处理的临时日任务" />
      ) : (
        <div className="daily-pool-list">
          {tasks.map((entry) => (
            <div key={entry.publicId}>
              <span>
                {entry.title}
                <small>计划日 {entry.plannedDate}</small>
              </span>
              <Button onClick={() => navigate(`/focus?date=${entry.plannedDate}`)}>打开</Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="link"
        style={{ minHeight: 44, marginTop: 12 }}
        onClick={() => navigate('/focus')}
      >
        记录今天的日任务
      </Button>
    </div>
  )
}
