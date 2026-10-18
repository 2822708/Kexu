import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Card, Empty, Input, Popconfirm, Space, Tag, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons'
import type { Course } from '../types'
import { formatWeeks, weekDayName } from '../utils/schedule'

/**
 * 课程名 → 明亮色板槽位（与 TimetableGrid 同算法，保证同一课程颜色稳定）。
 * 取值全部走 --b-* 变量，暗色模式由设计系统自动切换。
 */
const BRIGHT_SLOTS = [
  { bg: 'var(--b-blue-soft)', bar: 'var(--b-blue)', ink: 'var(--b-blue-ink)' },
  { bg: 'var(--b-green-soft)', bar: 'var(--b-green)', ink: 'var(--b-green-ink)' },
  { bg: 'var(--b-yellow-soft)', bar: 'var(--b-yellow)', ink: 'var(--b-yellow-ink)' },
  { bg: 'var(--b-purple-soft)', bar: 'var(--b-purple)', ink: 'var(--b-purple-ink)' },
  { bg: 'var(--b-red-soft)', bar: 'var(--b-red)', ink: 'var(--b-red-ink)' },
]

function brightCourseColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 100000
  return BRIGHT_SLOTS[hash % BRIGHT_SLOTS.length]
}

/** 列表容器卡片：白底 + 大圆角 + 柔影（明亮风） */
const listCardStyle = {
  borderRadius: 'var(--b-radius)',
  boxShadow: 'var(--b-sh2)',
  '--border-dark': 'var(--b-line)',
} as CSSProperties

/** 课程卡片：白底 + 大圆角 + 柔影（明亮风） */
const courseCardStyle: CSSProperties = {
  border: '1px solid var(--b-line)',
  borderRadius: 'var(--b-radius)',
  boxShadow: 'var(--b-sh2)',
  background: 'var(--bg-card)',
}

interface Props {
  courses: Course[]
  onEdit: (course: Course) => void
  onDelete: (course: Course) => void
}

/**
 * 全部课程视图（卡片式）。
 *
 * 不用表格，避免窄屏下左右滚动：卡片网格随容器宽度自动换列，
 * 每张卡片完整展示星期、节次、周次、地点、教师。
 */
export default function CourseListView({ courses, onEdit, onDelete }: Props) {
  const [keyword, setKeyword] = useState('')

  const data = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const filtered = kw
      ? courses.filter((c) =>
          [c.name, c.location, c.teacher]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(kw)),
        )
      : courses
    return [...filtered].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startPeriod - b.startPeriod || a.id - b.id,
    )
  }, [courses, keyword])

  return (
    <Card size="small" style={listCardStyle}>
      <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }} wrap>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索课程名 / 地点 / 教师"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
          style={{ maxWidth: 320, flex: 1 }}
        />
        <Typography.Text type="secondary">
          共 {data.length} 条上课记录
          {keyword && ` / 全部 ${courses.length} 条`}
        </Typography.Text>
      </Space>

      {data.length === 0 ? (
        <Empty description={keyword ? '没有匹配的课程' : '该课表还没有课程'} />
      ) : (
        <div className="course-card-grid">
          {data.map((c) => {
            const color = brightCourseColor(c.name)
            const odd = c.weeks.length > 1 && c.weeks.every((w) => w % 2 === 1)
            const even = c.weeks.length > 1 && c.weeks.every((w) => w % 2 === 0)
            return (
              <div key={c.id} className="course-card" style={courseCardStyle}>
                <div className="course-card-head">
                  <span
                    className="course-card-bar"
                    style={{ background: color.bar, borderRadius: 99 }}
                  />
                  <Typography.Text strong className="course-card-name" style={{ fontWeight: 800 }}>
                    {c.name}
                  </Typography.Text>
                </div>
                <div className="course-card-meta">
                  <Tag>{weekDayName(c.dayOfWeek)}</Tag>
                  <span>
                    第 {c.startPeriod}-{c.endPeriod} 节
                  </span>
                </div>
                <div className="course-card-line">
                  <span className="course-card-label">周次</span>
                  <span style={{ wordBreak: 'break-word' }}>{formatWeeks(c.weeks)}</span>
                  {odd && <span className="b-pill yellow">单周</span>}
                  {even && <span className="b-pill blue">双周</span>}
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {c.weeks.length}周
                  </Typography.Text>
                </div>
                <div className="course-card-line">
                  <span className="course-card-label">地点</span>
                  {c.location || <span className="text-muted">未指定</span>}
                </div>
                <div className="course-card-line">
                  <span className="course-card-label">教师</span>
                  {c.teacher || <span className="text-muted">未指定</span>}
                </div>
                <div className="course-card-actions">
                  <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(c)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="确定删除这条课程吗？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => onDelete(c)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
