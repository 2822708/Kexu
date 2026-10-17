import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  BellOutlined,
  CalendarOutlined,
  CheckOutlined,
  CloseOutlined,
  ImportOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { aiApi, noticeApi } from '../api'
import { useApp } from '../store/AppContext'
import type { NoticeCard, TaskDraft } from '../types'
import { dayjs } from '../utils/schedule'

const { Text } = Typography

const RELEVANCE_LABELS: Record<number, string> = { 1: '强相关', 2: '可能相关', 3: '泛泛相关' }
const RELEVANCE_COLORS: Record<number, string> = { 1: 'red', 2: 'orange', 3: 'default' }

/**
 * 通知卡片「一键了解详情」走的 prompt。
 *
 * 与 QuickImportWidget 的 importPrompt 不同：这里要的是**补充深度信息**，
 * 不是抽任务。明确要求模型别替用户做决定——本项目的底线是 human-in-the-loop。
 */
function noticeDetailPrompt(card: NoticeCard): string {
  return [
    `请帮我详细了解这条校园通知：${card.source}｜${card.title}`,
    card.summary ? `已知信息：${card.summary}` : '',
    card.requirement ? `相关要求：${card.requirement}` : '',
    card.keyTime ? `关键时间：${dayjs(card.keyTime).format('YYYY-MM-DD HH:mm')}` : '',
    '',
    '请补充：报名/参与的具体条件、流程、截止时间、可能的收益（加分、学分、综测）、',
    '以及需要注意的坑。如果信息不足无法确认，直接说不确定，不要编造。',
    '不要替我决定是否参加，也不要自动创建任何任务或日程。',
  ]
    .filter(Boolean)
    .join('\n')
}

interface NoticeInboxPanelProps {
  notices: NoticeCard[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** 午间模式用紧凑布局：不展示要求详情，按钮收进一行 */
  compact?: boolean
}

/**
 * 今日待阅（AI Campus Agent · 通知箱）。
 *
 * 卡片上有三个动作，全部由用户发起：加入日程 / 忽略 / 稍后提醒。
 * 没有自动执行——这不是保守，是因为通知里绝大多数是「知道了就行」的信息，
 * 自动转任务会让待办区迅速失去信噪比。
 */
export default function NoticeInboxPanel({
  notices,
  loading,
  error,
  onRefresh,
  compact = false,
}: NoticeInboxPanelProps) {
  const navigate = useNavigate()
  const { activeScheduleId } = useApp()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const guard = async (id: number, action: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id)
    setErr(null)
    try {
      await action()
      message.success(okMsg)
      onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败，请稍后重试')
    } finally {
      setBusyId(null)
    }
  }

  /** 加入日程：用卡片内容兜底草稿，用户不用先填一遍表单 */
  const toTask = (card: NoticeCard) => {
    const draft: TaskDraft = {
      title: card.title,
      type: 'OTHER',
      deadline: card.keyTime,
      priority: card.relevance === 1 ? 1 : 2,
      description: card.summary || '',
    }
    void guard(card.id, () => noticeApi.toTask(card.id, draft), '已加入日程')
  }

  /**
   * 一键了解详情：跳到 AI 聊天页并把 prompt 填进输入框。
   *
   * 照抄 QuickImportWidget 的既有通道——只填输入框**不自动发送**，
   * 符合项目全局的 human-in-the-loop 惯例，也不用改 AiChatPage。
   */
  const askDetail = async (card: NoticeCard) => {
    try {
      const conversation = await aiApi.createConversation(activeScheduleId)
      navigate('/ai', {
        state: {
          quickImport: {
            conversationId: conversation.id,
            scheduleId: activeScheduleId,
            prompt: noticeDetailPrompt(card),
          },
        },
      })
    } catch {
      message.error('打开 AI 助手失败，请稍后重试')
    }
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <BellOutlined />
          <span>今日待阅</span>
          <Tag color="blue">{notices.length}</Tag>
        </Space>
      }
      extra={
        <Button
          type="link"
          size="small"
          icon={<ImportOutlined />}
          onClick={() => navigate('/ai')}
        >
          转发通知给助手
        </Button>
      }
      loading={loading}
    >
      {(err || error) && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={err ?? error}
          action={
            <Button size="small" onClick={onRefresh}>
              重试
            </Button>
          }
        />
      )}

      {notices.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Space direction="vertical" align="center" size={2}>
              <span>暂时没有待你决定的通知</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                把群公告、教务通知转发给助手，它会提炼成卡片放在这里
              </Text>
            </Space>
          }
          style={{ margin: '12px 0' }}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {notices.map((card) => (
            <div
              key={card.id}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                background: 'var(--bg-card)',
              }}
            >
              <Space size={6} wrap style={{ marginBottom: 4 }}>
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                  {card.source}
                </Tag>
                <Tag
                  color={RELEVANCE_COLORS[card.relevance] ?? 'default'}
                  style={{ marginInlineEnd: 0 }}
                >
                  {RELEVANCE_LABELS[card.relevance] ?? '可能相关'}
                </Tag>
                {card.keyTime && (
                  <Tag icon={<CalendarOutlined />} color="volcano" style={{ marginInlineEnd: 0 }}>
                    {dayjs(card.keyTime).format('MM-DD HH:mm')}
                  </Tag>
                )}
              </Space>

              <div>
                <Typography.Text strong>{card.title}</Typography.Text>
              </div>

              {!compact && card.summary && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                  {card.summary}
                </div>
              )}
              {!compact && card.requirement && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                  要求：{card.requirement}
                </div>
              )}

              <Space size={6} wrap style={{ marginTop: 8 }}>
                <Tooltip title="把这条通知转成任务，放进今日必做">
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={busyId === card.id}
                    onClick={() => toTask(card)}
                  >
                    加入日程
                  </Button>
                </Tooltip>
                <Button
                  size="small"
                  icon={<MessageOutlined />}
                  onClick={() => void askDetail(card)}
                >
                  一键了解详情
                </Button>
                <Button
                  size="small"
                  onClick={() => void guard(card.id, () => noticeApi.snooze(card.id, 4), '4 小时后再提醒')}
                >
                  稍后提醒
                </Button>
                <Popconfirm
                  title="忽略这条通知？"
                  description="同类来源的通知后续会排在后面，但不会消失。"
                  okText="忽略"
                  cancelText="取消"
                  onConfirm={() => void guard(card.id, () => noticeApi.ignore(card.id), '已忽略')}
                >
                  <Button size="small" icon={<CloseOutlined />} loading={busyId === card.id}>
                    忽略
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          ))}
        </Space>
      )}
    </Card>
  )
}
