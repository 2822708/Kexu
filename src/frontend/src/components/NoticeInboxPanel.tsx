import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
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
/** 相关度药丸：强相关=蓝（重点未读语义），可能相关=黄，泛泛=中性 */
const RELEVANCE_PILLS: Record<number, string> = { 1: 'blue', 2: 'yellow' }
const NEUTRAL_PILL_STYLE = { background: 'var(--b-bg-soft)', color: 'var(--b-ink-faint)' } as const

/** 通知类型推断（纯视觉映射：课程蓝 / 考试红 / 待办黄 / 系统绿） */
function noticeTypePill(source: string): { variant: string; label: string } {
  if (/考试|六级|四级|考研|期末|测验/.test(source)) return { variant: 'red', label: '考试' }
  if (/课程|选课|教务|教学|调课|实验/.test(source)) return { variant: 'blue', label: '课程' }
  if (/报名|截止|活动|竞赛|讲座|通知/.test(source)) return { variant: 'yellow', label: '待办' }
  return { variant: 'green', label: '系统' }
}

/** 列表项卡片：白底 + 柔影 + 大圆角 */
const NOTICE_CARD_STYLE = {
  padding: '12px 14px',
  borderRadius: 'var(--b-radius)',
  background: 'var(--bg-card)',
  boxShadow: 'var(--b-sh2)',
} as const

/** 主操作 3D 小按钮（绿） */
const PRIMARY_BTN_STYLE = { fontSize: 13, padding: '5px 14px' } as const

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
          <span className="b-pill blue">{notices.length}</span>
        </Space>
      }
      extra={
        <Button
          type="link"
          size="small"
          icon={<ImportOutlined />}
          onClick={() => navigate('/ai')}
          style={{ color: 'var(--b-blue-ink)', fontWeight: 800 }}
        >
          转发通知给助手
        </Button>
      }
      loading={loading}
      style={{ borderRadius: 'var(--b-radius)', boxShadow: 'var(--b-sh2)' }}
    >
      {(err || error) && (
        <Alert
          type="error"
          showIcon
          style={{
            marginBottom: 12,
            borderRadius: 'var(--b-radius-sm)',
            background: 'var(--b-red-soft)',
            border: '1px solid var(--b-line)',
          }}
          message={err ?? error}
          action={
            <Button size="small" onClick={onRefresh}>
              重试
            </Button>
          }
        />
      )}

      {notices.length === 0 ? (
        <div
          style={{
            background: 'var(--b-bg-soft)',
            borderRadius: 'var(--b-radius)',
            padding: '18px 12px',
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" align="center" size={2}>
                <span style={{ color: 'var(--b-ink-soft)' }}>暂时没有待你决定的通知</span>
                <Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-faint)' }}>
                  把群公告、教务通知转发给助手，它会提炼成卡片放在这里
                </Text>
              </Space>
            }
            style={{ margin: '12px 0' }}
          />
        </div>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {notices.map((card) => (
            <div key={card.id} style={NOTICE_CARD_STYLE}>
              <Space size={6} wrap style={{ marginBottom: 6 }}>
                <span className={`b-pill ${noticeTypePill(card.source).variant}`}>
                  {noticeTypePill(card.source).label}
                </span>
                <span className="b-pill" style={NEUTRAL_PILL_STYLE}>
                  {card.source}
                </span>
                <span
                  className={RELEVANCE_PILLS[card.relevance] ? `b-pill ${RELEVANCE_PILLS[card.relevance]}` : 'b-pill'}
                  style={RELEVANCE_PILLS[card.relevance] ? undefined : NEUTRAL_PILL_STYLE}
                >
                  {RELEVANCE_LABELS[card.relevance] ?? '可能相关'}
                </span>
                {card.keyTime && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--b-ink-faint)',
                    }}
                  >
                    <CalendarOutlined />
                    {dayjs(card.keyTime).format('MM-DD HH:mm')}
                  </span>
                )}
              </Space>

              <div>
                <Typography.Text strong style={{ color: 'var(--b-ink)' }}>
                  {card.title}
                </Typography.Text>
              </div>

              {!compact && card.summary && (
                <div style={{ color: 'var(--b-ink-soft)', fontSize: 12, marginTop: 2 }}>
                  {card.summary}
                </div>
              )}
              {!compact && card.requirement && (
                <div style={{ color: 'var(--b-ink-soft)', fontSize: 12, marginTop: 2 }}>
                  要求：{card.requirement}
                </div>
              )}

              <Space size={6} wrap style={{ marginTop: 8 }}>
                <Tooltip title="把这条通知转成任务，放进今日必做">
                  <button
                    type="button"
                    className="b-btn-3d"
                    disabled={busyId === card.id}
                    onClick={() => toTask(card)}
                    style={PRIMARY_BTN_STYLE}
                  >
                    <CheckOutlined />
                    加入日程
                  </button>
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
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    disabled={busyId === card.id}
                    style={{ color: 'var(--b-red-ink)' }}
                  >
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
