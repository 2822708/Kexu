import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { memoryApi } from '../api'
import type { Memory, MemoryType } from '../types'

/** 记忆类型的中文名（与后端类型白名单一致） */
const TYPE_OPTIONS: { value: MemoryType; label: string; color: string }[] = [
  { value: 'GOAL', label: '目标', color: 'red' },
  { value: 'INTEREST', label: '兴趣', color: 'orange' },
  { value: 'ABILITY', label: '能力', color: 'blue' },
  { value: 'HABIT', label: '习惯', color: 'green' },
  { value: 'PREFERENCE', label: '偏好', color: 'purple' },
]

const TYPE_COLOR: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.color]),
)

const IMPORTANCE_OPTIONS = [1, 2, 3, 4, 5].map((v) => ({
  value: v,
  label: `${v} · ${['随口一提', '一般', '较重要', '重要', '核心'][v - 1]}`,
}))

/**
 * 长期记忆管理（AI Campus Agent V1.0 Step 7）。
 *
 * 学长从对话里提炼的记忆在这里可见、可改、可删；改完下一轮对话就按新内容注入。
 * 归档与删除的区别：归档只是不再进入 AI 上下文（留痕），删除是彻底移除。
 */
export default function MemoryManager() {
  const [items, setItems] = useState<Memory[]>([])
  const [limit, setLimit] = useState(20)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState({ type: 'PREFERENCE' as MemoryType, content: '', importance: 3 })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editImportance, setEditImportance] = useState(3)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await memoryApi.list()
      setItems(data.items ?? [])
      setLimit(data.limit ?? 20)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '记忆加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    const content = draft.content.trim()
    if (!content) {
      message.warning('请先填写要记住的内容')
      return
    }
    setSaving(true)
    try {
      await memoryApi.create({ type: draft.type, content, importance: draft.importance })
      message.success('已记住')
      setDraft({ ...draft, content: '' })
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async (id: number) => {
    const content = editContent.trim()
    if (!content) {
      message.warning('内容不能为空')
      return
    }
    setSaving(true)
    try {
      await memoryApi.update(id, { content, importance: editImportance })
      message.success('已更新，下次对话即生效')
      setEditingId(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const archive = async (id: number) => {
    try {
      await memoryApi.archive(id)
      message.success('已归档，不再参与 AI 上下文')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '归档失败')
    }
  }

  const remove = async (id: number) => {
    try {
      await memoryApi.remove(id)
      message.success('已删除')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const columns: ColumnsType<Memory> = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 84,
      render: (type: MemoryType) => (
        <Tag color={TYPE_COLOR[type] ?? 'default'}>
          {TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type}
        </Tag>
      ),
    },
    {
      title: '内容',
      dataIndex: 'content',
      render: (content: string, row) =>
        editingId === row.id ? (
          <Input
            autoFocus
            value={editContent}
            maxLength={200}
            onChange={(e) => setEditContent(e.target.value)}
            onPressEnter={() => void saveEdit(row.id)}
          />
        ) : (
          <Typography.Text>{content}</Typography.Text>
        ),
    },
    {
      title: '重要度',
      dataIndex: 'importance',
      width: 140,
      render: (importance: number, row) =>
        editingId === row.id ? (
          <Select
            value={editImportance}
            options={IMPORTANCE_OPTIONS}
            style={{ width: '100%' }}
            onChange={setEditImportance}
          />
        ) : (
          <Typography.Text style={{ letterSpacing: 1 }}>
            {'★'.repeat(importance)}
            <span style={{ opacity: 0.3 }}>{'★'.repeat(5 - importance)}</span>
          </Typography.Text>
        ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 76,
      responsive: ['md', 'lg', 'xl', 'xxl'],
      render: (source: string) =>
        source === 'AI' ? <Tag color="magenta">AI</Tag> : <Tag>手动</Tag>,
    },
    {
      title: '操作',
      width: 168,
      render: (_, row) =>
        editingId === row.id ? (
          <Space size={4}>
            <Button type="link" size="small" loading={saving} onClick={() => void saveEdit(row.id)}>
              保存
            </Button>
            <Button type="link" size="small" onClick={() => setEditingId(null)}>
              取消
            </Button>
          </Space>
        ) : (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setEditingId(row.id)
                setEditContent(row.content)
                setEditImportance(row.importance)
              }}
            >
              编辑
            </Button>
            <Button type="link" size="small" onClick={() => void archive(row.id)}>
              归档
            </Button>
            <Popconfirm title="彻底删除这条记忆？" onConfirm={() => void remove(row.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
    },
  ]

  const overflow = items.length > limit

  return (
    <Card
      title="长期记忆"
      extra={
        <Button size="small" onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="学长会把对话中跨天成立的事实记在这里，回答时自动参考。同一件事只保留一条（会自动合并），不想要的内容可以直接改掉或删除。"
        />
        <Space.Compact style={{ width: '100%' }}>
          <Select
            value={draft.type}
            options={TYPE_OPTIONS.map(({ value, label }) => ({ value, label }))}
            style={{ width: 96 }}
            onChange={(type) => setDraft({ ...draft, type })}
          />
          <Input
            placeholder="例如：准备 12 月 CET-6 考试"
            value={draft.content}
            maxLength={200}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            onPressEnter={() => void add()}
          />
          <Select
            value={draft.importance}
            options={IMPORTANCE_OPTIONS}
            style={{ width: 132 }}
            onChange={(importance) => setDraft({ ...draft, importance })}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={saving}
            onClick={() => void add()}
          >
            记住
          </Button>
        </Space.Compact>

        {items.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有记忆，和学长多聊几句就会自动记下要点"
          />
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            pagination={false}
          />
        )}

        {overflow && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            共 {items.length} 条，按重要度只有前 {limit} 条会进入 AI 上下文；其余归档或删除后才会被看到。
          </Typography.Text>
        )}
      </Space>
    </Card>
  )
}
