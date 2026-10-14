import { Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AiAction, AiActionScope } from '../types'
import { formatWeeks, weekDayName } from '../utils/schedule'
import { taskPriorityLabel, taskTypeLabel } from '../utils/task'
import { describeOffset } from '../utils/recurring'

const ACTION_LABELS: Record<string, string> = {
  CREATE_COURSE: '添加课程',
  UPDATE_COURSE: '修改课程',
  DELETE_COURSE: '删除课程',
  CREATE_TODO: '添加待办',
  UPDATE_TODO: '修改待办',
  DELETE_TODO: '删除待办',
  TOGGLE_TODO: '切换待办状态',
  CREATE_TASK: '添加任务',
  UPDATE_TASK: '修改任务',
  CREATE_RECURRING: '添加循环任务',
  UPDATE_RECURRING: '修改循环任务',
  DELETE_RECURRING: '删除循环任务',
  TOGGLE_RECURRING: '启用/停用循环任务',
  CREATE_EXAM: '添加考试',
  UPDATE_EXAM: '修改考试',
  DELETE_EXAM: '删除考试',
  SAVE_MEMORY: '记住这个信息',
  UPDATE_PROFILE: '更新学生档案',
}

/** 作用域标签：循环任务归待办域，但卡片上单独标明，避免与普通待办混淆。 */
const SCOPE_TAGS: Record<AiActionScope, { color: string; label: string }> = {
  COURSE: { color: 'geekblue', label: '课表' },
  TODO: { color: 'purple', label: '待办' },
  TASK: { color: 'cyan', label: '任务' },
  PROFILE: { color: 'gold', label: '档案' },
  MEMORY: { color: 'magenta', label: '记忆' },
}

/** 长期记忆类型的中文名（与后端 Memory 类型白名单一致）。 */
const MEMORY_TYPE_LABELS: Record<string, string> = {
  GOAL: '目标',
  INTEREST: '兴趣',
  ABILITY: '能力',
  HABIT: '习惯',
  PREFERENCE: '偏好',
}

/** 档案字段的中文名（与后端档案白名单一致，顺序即展示顺序）。 */
const PROFILE_FIELDS: [string, string][] = [
  ['name', '姓名'],
  ['school', '学校'],
  ['major', '专业'],
  ['grade', '年级'],
  ['goal', '目标'],
  ['learningStyle', '学习风格'],
  ['interest', '兴趣'],
  ['skills', '技能'],
]

interface Props {
  action: AiAction
  executing: boolean
  onExecute: () => void
  onReject: () => void
  disabled?: boolean
  scheduleName?: string | null
}

type Dict = Record<string, unknown>

interface DiffRow {
  key: string
  field: string
  before: string
  after: string
  changed: boolean
}

export default function AiActionCard({ action, executing, onExecute, onReject, disabled, scheduleName }: Props) {
  const data = (action.data ?? {}) as Dict
  const pending = action.status === 'PENDING'
  const stale = action.status === 'STALE'
  const affected = ['courses', 'todos', 'tasks', 'rules', 'exams', 'courseIds', 'todoIds', 'recurringIds', 'examIds', 'memories']
    .map((key) => data[key]).find(Array.isArray) as unknown[] | undefined
  const scopeTag = SCOPE_TAGS[action.scope] ?? { color: 'purple', label: action.scope }
  const scopeLabel = action.scope === 'TODO' && action.type.includes('RECURRING') ? '循环任务' : scopeTag.label

  const statusTag =
    action.status === 'EXECUTED' ? (
      <Tag color="green">已执行</Tag>
    ) : action.status === 'REJECTED' ? (
      <Tag>已取消</Tag>
    ) : action.status === 'EXECUTING' ? (
      <Tag color="processing">执行中</Tag>
    ) : stale ? (
      <Tooltip title="相关数据已变化，或已有更新的提案，此提案不能再执行">
        <Tag color="default">已失效</Tag>
      </Tooltip>
    ) : (
      <Tag color="orange">待确认</Tag>
    )

  return (
    <Card
      className="chat-action-card"
      size="small"
      style={stale ? { opacity: 0.6 } : undefined}
      title={
        <Space>
          <span>{ACTION_LABELS[action.type] ?? action.type}</span>
          <Tag color={scopeTag.color}>{scopeLabel}</Tag>
          {statusTag}
        </Space>
      }
      extra={
        pending && (
          <Space>
            <Button
              size="small"
              type="primary"
              loading={executing}
              disabled={disabled || executing}
              onClick={onExecute}
            >
              确认执行
            </Button>
            <Button size="small" disabled={disabled || executing} onClick={onReject}>
              取消
            </Button>
          </Space>
        )
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        {action.scope === 'COURSE'
          ? `目标课表：${scheduleName ?? (action.scheduleId ? `课表 #${action.scheduleId}（已删除或不可用）` : '未绑定')}`
          : action.scope === 'PROFILE'
            ? '作用范围：当前账号的学生档案'
            : action.scope === 'MEMORY'
              ? '作用范围：当前账号的长期记忆'
              : action.scope === 'TASK'
                ? '作用范围：当前账号的学习任务（与待办相互独立）'
                : '作用范围：当前账号的待办（所有课表共用）'}
        {' · '}
        {action.scope === 'PROFILE'
          ? `更新 ${Object.keys(data).filter((k) => k !== '_before').length} 个档案字段`
          : `影响 ${affected?.length ?? 0} 条记录`}
        {action.type === 'DELETE_EXAM' && '；对应考试待办也会删除'}
      </Typography.Paragraph>
      {renderBody(action.type, data)}
      {stale && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          数据已变动，请重新向 AI 提问以获得最新提案。
        </Typography.Text>
      )}
    </Card>
  )
}

const DIFF_COLUMNS: ColumnsType<DiffRow> = [
  { title: '字段', dataIndex: 'field', width: 90 },
  {
    title: '修改前',
    dataIndex: 'before',
    render: (v: string, row) => (
      <Typography.Text delete={row.changed} type={row.changed ? 'secondary' : undefined}>
        {v}
      </Typography.Text>
    ),
  },
  {
    title: '修改后',
    dataIndex: 'after',
    render: (v: string, row) => (
      <Typography.Text strong={row.changed} type={row.changed ? 'danger' : undefined}>
        {v}
      </Typography.Text>
    ),
  },
]

function recurringLine(r: Dict): string {
  const offset = describeOffset(Number(r.ddlOffsetMinutes))
  const chain = r.chainAfterComplete ? '，完成后接下一期' : ''
  if (r.frequency === 'CUSTOM') {
    return `自定义脚本判断触发，触发后 ${offset} 截止${chain}`
  }
  const time = String(r.triggerTime ?? '').slice(0, 5) || '--:--'
  let when: string
  switch (r.frequency) {
    case 'DAILY':
      when = `每天 ${time}`
      break
    case 'WEEKLY':
      when = `每${weekDayName(Number(r.dayOfWeek))} ${time}`
      break
    case 'MONTHLY':
      when = `每月 ${r.dayOfMonth} 号 ${time}`
      break
    default:
      when = time
  }
  return `${when} 触发，触发后 ${offset} 截止${chain}`
}

function recurringDiff(b: Dict, a: Dict): DiffRow[] {
  const rows: [string, string, string][] = [
    ['标题', str(b.title), str(a.title)],
    [
      '触发规则',
      b.frequency ? recurringLine(b) : '未指定',
      a.frequency ? recurringLine(a) : '未指定',
    ],
    ['脚本', scriptSummary(b.script), scriptSummary(a.script)],
  ]
  return rows.map(([field, before, after]) => ({
    key: field,
    field,
    before,
    after,
    changed: before !== after,
  }))
}

function scriptSummary(v: unknown): string {
  if (v === null || v === undefined || v === '') return '无'
  const s = String(v)
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

function renderBody(type: string, data: Dict) {
  const before = (data._before as Dict[]) ?? []

  if (type === 'CREATE_RECURRING') {
    const rules = (data.rules as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {rules.map((r, i) => (
          <div key={i}>
            <Typography.Text strong>{str(r.title)}</Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{recurringLine(r)}</div>
            {r.script ? <pre className="ai-script-block">{String(r.script)}</pre> : null}
          </div>
        ))}
      </Space>
    )
  }

  if (type === 'UPDATE_RECURRING') {
    const after = (data.rules as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {after.map((a, i) => {
          const b = before.find((x) => x.id === a.id) ?? {}
          const scriptChanged = Boolean(a.script) && String(a.script) !== String(b.script ?? '')
          return (
            <div key={i}>
              <Table
                size="small"
                rowKey="key"
                columns={DIFF_COLUMNS}
                dataSource={recurringDiff(b, a)}
                pagination={false}
              />
              {scriptChanged ? <pre className="ai-script-block">{String(a.script)}</pre> : null}
            </div>
          )
        })}
      </Space>
    )
  }

  if (type === 'DELETE_RECURRING' || type === 'TOGGLE_RECURRING') {
    if (before.length > 0) {
      return (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {type === 'TOGGLE_RECURRING'
              ? '将切换以下循环任务的启用状态：'
              : '将删除以下循环任务（已生成的待办保留）：'}
          </Typography.Text>
          {before.map((r, i) => (
            <div key={i}>
              <Typography.Text delete={type === 'DELETE_RECURRING'} strong>
                {str(r.title)}
              </Typography.Text>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {recurringLine(r)}
                {type === 'TOGGLE_RECURRING' &&
                  `（当前${r.enabled ? '启用' : '停用'} → ${r.enabled ? '停用' : '启用'}）`}
              </div>
            </div>
          ))}
        </Space>
      )
    }
    const ids = data.recurringIds as unknown[] | undefined
    if (Array.isArray(ids)) return <span>目标 ID：{ids.join(', ')}</span>
  }

  if (type === 'UPDATE_COURSE') {
    const after = (data.courses as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {after.map((a, i) => {
          const b = before.find((x) => x.id === a.id) ?? {}
          // 只展示发生变化的字段；其余字段按课程摘要一行展示
          const changedRows = courseDiff(b, a).filter((r) => r.changed)
          return (
            <div key={i}>
              <Typography.Text strong>{str(a.name ?? b.name)}</Typography.Text>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{courseLine(a)}</div>
              {changedRows.length > 0 && (
                <Table
                  size="small"
                  rowKey="key"
                  columns={DIFF_COLUMNS}
                  dataSource={changedRows}
                  pagination={false}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
          )
        })}
      </Space>
    )
  }

  if (type === 'UPDATE_TODO') {
    const after = (data.todos as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {after.map((a, i) => {
          const b = before.find((x) => x.id === a.id) ?? {}
          return (
            <Table
              key={i}
              size="small"
              rowKey="key"
              columns={DIFF_COLUMNS}
              dataSource={todoDiff(b, a)}
              pagination={false}
            />
          )
        })}
      </Space>
    )
  }

  if (type === 'CREATE_TASK') {
    const tasks = (data.tasks as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          学长想把以下事项记为学习任务（与待办相互独立），确认后创建：
        </Typography.Text>
        {tasks.map((t, i) => (
          <div key={i}>
            <Typography.Text strong>{str(t.title)}</Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{taskLine(t)}</div>
          </div>
        ))}
      </Space>
    )
  }

  if (type === 'UPDATE_TASK') {
    const after = (data.tasks as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {after.map((a, i) => {
          const b = before.find((x) => x.id === a.id) ?? {}
          const changedRows = taskDiff(b, a).filter((r) => r.changed)
          return (
            <div key={i}>
              <Typography.Text strong>{str(a.title ?? b.title)}</Typography.Text>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{taskLine(a)}</div>
              {changedRows.length > 0 && (
                <Table
                  size="small"
                  rowKey="key"
                  columns={DIFF_COLUMNS}
                  dataSource={changedRows}
                  pagination={false}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
          )
        })}
      </Space>
    )
  }

  if (type === 'CREATE_COURSE') {
    const courses = (data.courses as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {courses.map((c, i) => (
          <div key={i}>
            <Typography.Text strong>{str(c.name)}</Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{courseLine(c)}</div>
          </div>
        ))}
      </Space>
    )
  }

  if (type === 'CREATE_TODO') {
    const todos = (data.todos as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {todos.map((t, i) => (
          <div key={i}>
            <Typography.Text strong>{str(t.title)}</Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>截止 {str(t.ddl)}</div>
          </div>
        ))}
      </Space>
    )
  }

  if (type === 'CREATE_EXAM') {
    const exams = (data.exams as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {exams.map((e, i) => (
          <div key={i}>
            <Typography.Text strong>{str(e.name)}</Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{examLine(e)}</div>
          </div>
        ))}
      </Space>
    )
  }

  if (type === 'UPDATE_EXAM') {
    const after = (data.exams as Dict[]) ?? []
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {after.map((a, i) => {
          const b = before.find((x) => x.id === a.id) ?? {}
          const changedRows = examDiff(b, a).filter((r) => r.changed)
          return (
            <div key={i}>
              <Typography.Text strong>{str(a.name ?? b.name)}</Typography.Text>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{examLine(a)}</div>
              {changedRows.length > 0 && (
                <Table
                  size="small"
                  rowKey="key"
                  columns={DIFF_COLUMNS}
                  dataSource={changedRows}
                  pagination={false}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
          )
        })}
      </Space>
    )
  }

  if (type === 'DELETE_EXAM') {
    if (before.length > 0) {
      return (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将删除以下考试记录：
          </Typography.Text>
          {before.map((b, i) => (
            <div key={i}>
              <Typography.Text delete strong>
                {str(b.name)}
              </Typography.Text>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{examLine(b)}</div>
            </div>
          ))}
        </Space>
      )
    }
    const ids = data.examIds as unknown[] | undefined
    if (Array.isArray(ids)) return <span>目标 ID：{ids.join(', ')}</span>
  }

  if (type === 'SAVE_MEMORY') {
    const items = (data.memories as Dict[]) ?? []
    // Step 7：action=UPDATE 是「修正已有记忆」，不会新增条目；ADD（缺省）才是新增
    const updating = items.some(
      (m) => String(m.action ?? 'ADD').toUpperCase() === 'UPDATE' && m.target_id != null,
    )
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {updating
            ? '学长想修正已有记忆（不会新增条目），之后回答问题时会参考：'
            : '学长想把以下信息记入长期记忆，之后回答问题时会参考：'}
        </Typography.Text>
        {items.map((m, i) => {
          const isUpdate =
            String(m.action ?? 'ADD').toUpperCase() === 'UPDATE' && m.target_id != null
          const stars = Math.min(5, Math.max(1, Number(m.importance) || 3))
          return (
            <div key={i}>
              <Space size={4} wrap>
                <Tag color="magenta">{MEMORY_TYPE_LABELS[String(m.type)] ?? String(m.type)}</Tag>
                {isUpdate && <Tag color="blue">修正 #{String(m.target_id)}</Tag>}
                <Typography.Text strong>{str(m.content)}</Typography.Text>
              </Space>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                重要度 {'★'.repeat(stars)}
                {'☆'.repeat(5 - stars)}（{Number(m.importance) || 3}/5）
              </div>
            </div>
          )
        })}
      </Space>
    )
  }

  if (type === 'UPDATE_PROFILE') {
    // 档案是单例：_before 是整份档案快照（对象而非数组），缺失表示新建档案。
    // 只展示提案实际提到的字段——未提及的字段保持原值，不能显示成「将被清空」。
    const snapshot = (data._before ?? null) as Dict | null
    const rows = PROFILE_FIELDS.filter(([field]) => data[field] !== undefined && data[field] !== null)
      .map(([field, label]) => ({
        key: field,
        field: label,
        before: snapshot ? profileValue(snapshot[field]) : '（档案尚不存在）',
        after: profileValue(data[field]),
        changed: snapshot ? profileValue(snapshot[field]) !== profileValue(data[field]) : true,
      }))
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {snapshot ? '将把学生档案更新为：' : '将新建学生档案并填写：'}
        </Typography.Text>
        <Table
          size="small"
          rowKey="key"
          columns={DIFF_COLUMNS}
          dataSource={rows}
          pagination={false}
        />
      </Space>
    )
  }

  // DELETE_COURSE / DELETE_TODO / TOGGLE_TODO：展示将被影响的原始记录
  if (before.length > 0) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {type === 'TOGGLE_TODO' ? '将切换以下待办的完成状态：' : '将删除以下记录：'}
        </Typography.Text>
        {before.map((b, i) => (
          <div key={i}>
            <Typography.Text delete={type !== 'TOGGLE_TODO'} strong>
              {str(b.name ?? b.title)}
            </Typography.Text>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {b.dayOfWeek ? courseLine(b) : `截止 ${str(b.ddl)}`}
            </div>
          </div>
        ))}
      </Space>
    )
  }

  const ids = (data.courseIds ?? data.todoIds) as unknown[] | undefined
  if (Array.isArray(ids)) {
    return <span>目标 ID：{ids.join(', ')}</span>
  }

  return <pre style={{ margin: 0 }}>{JSON.stringify(data, null, 2)}</pre>
}

function courseDiff(b: Dict, a: Dict): DiffRow[] {
  const rows: [string, string, string][] = [
    ['课程名', str(b.name), str(a.name)],
    ['星期', dayStr(b.dayOfWeek), dayStr(a.dayOfWeek)],
    ['节次', periodStr(b), periodStr(a)],
    ['周次', weeksStr(b.weeks), weeksStr(a.weeks)],
    ['地点', str(b.location), str(a.location)],
    ['教师', str(b.teacher), str(a.teacher)],
  ]
  return rows.map(([field, before, after]) => ({
    key: field,
    field,
    before,
    after,
    changed: before !== after,
  }))
}

function todoDiff(b: Dict, a: Dict): DiffRow[] {
  const rows: [string, string, string][] = [
    ['标题', str(b.title), str(a.title)],
    ['截止时间', str(b.ddl), str(a.ddl)],
  ]
  return rows.map(([field, before, after]) => ({
    key: field,
    field,
    before,
    after,
    changed: before !== after,
  }))
}

/** 任务摘要行：类型 · 截止 · 优先级（创建卡片与 diff 卡片共用）。 */
function taskLine(t: Dict): string {
  const parts = [taskTypeLabel(t.type == null ? null : String(t.type))]
  parts.push(t.deadline ? `截止 ${str(t.deadline)}` : '无截止')
  parts.push(`${taskPriorityLabel(Number(t.priority))}优先级`)
  return parts.join(' · ')
}

function taskDiff(b: Dict, a: Dict): DiffRow[] {
  const rows: [string, string, string][] = [
    ['标题', str(b.title), str(a.title)],
    ['类型', b.type ? taskTypeLabel(String(b.type)) : '未指定', taskTypeLabel(a.type == null ? null : String(a.type))],
    ['截止时间', str(b.deadline), str(a.deadline)],
    [
      '优先级',
      b.priority ? `${taskPriorityLabel(Number(b.priority))}优先级` : '未指定',
      a.priority ? `${taskPriorityLabel(Number(a.priority))}优先级` : '未指定',
    ],
    ['状态', b.status ? String(b.status) : '未指定', str(a.status)],
    ['描述', str(b.description), str(a.description)],
  ]
  return rows.map(([field, before, after]) => ({
    key: field,
    field,
    before,
    after,
    changed: before !== after,
  }))
}

function courseLine(c: Dict): string {
  const parts = [dayStr(c.dayOfWeek), periodStr(c), `周次 ${weeksStr(c.weeks)}`]
  if (c.location) parts.push(String(c.location))
  if (c.teacher) parts.push(String(c.teacher))
  return parts.join(' · ')
}

function timeStr(v: unknown): string {
  if (v === null || v === undefined || v === '') return '未指定'
  return String(v).slice(0, 5)
}

function examLine(e: Dict): string {
  const parts = [`日期 ${str(e.examDate)}`, `时间 ${timeStr(e.startTime)}-${timeStr(e.endTime)}`]
  if (e.location) parts.push(String(e.location))
  return parts.join(' · ')
}

function examDiff(b: Dict, a: Dict): DiffRow[] {
  const rows: [string, string, string][] = [
    ['考试名', str(b.name), str(a.name)],
    ['日期', str(b.examDate), str(a.examDate)],
    [
      '时间',
      `${timeStr(b.startTime)}-${timeStr(b.endTime)}`,
      `${timeStr(a.startTime)}-${timeStr(a.endTime)}`,
    ],
    ['地点', str(b.location), str(a.location)],
  ]
  return rows.map(([field, before, after]) => ({
    key: field,
    field,
    before,
    after,
    changed: before !== after,
  }))
}

function dayStr(v: unknown): string {
  return typeof v === 'number' ? weekDayName(v) : '未指定'
}

function periodStr(c: Dict): string {
  return c.startPeriod && c.endPeriod ? `第 ${c.startPeriod}-${c.endPeriod} 节` : '未指定'
}

function weeksStr(v: unknown): string {
  return Array.isArray(v) && v.length > 0 ? formatWeeks(v as number[]) : '未指定'
}

function str(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未指定'
  return String(value)
}

/** 档案字段值：数组（兴趣/技能）用顿号连接，空值统一显示「未填写」。 */
function profileValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '未填写'
  if (Array.isArray(v)) return v.length > 0 ? v.map(String).join('、') : '未填写'
  return String(v)
}
