import { useEffect, useState } from 'react'
import { Alert, Checkbox, Input, Modal, Space, Typography } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import type { NoticeDraft, NoticeExtractResult } from '../types'

const RELEVANCE_LABELS: Record<number, string> = { 1: '强相关', 2: '可能相关', 3: '泛泛相关' }
/** 相关度药丸：强相关=蓝（重点未读语义），可能相关=黄，泛泛=中性 */
const RELEVANCE_PILLS: Record<number, string> = { 1: 'blue', 2: 'yellow' }
const NEUTRAL_PILL_STYLE = { background: 'var(--b-bg-soft)', color: 'var(--b-ink-faint)' } as const

/** 草稿卡：白底 + 大圆角 + 柔影 */
const DRAFT_CARD_STYLE = {
  padding: 12,
  borderRadius: 'var(--b-radius)',
  background: 'var(--bg-card)',
  boxShadow: 'var(--b-sh2)',
} as const

/** 弹脚 3D 按钮尺寸（内联覆盖 .b-btn-3d 大号默认值，非颜色锁定） */
const FOOTER_BTN_STYLE = { fontSize: 13.5, padding: '7px 16px' } as const

interface NoticeDraftModalProps {
  open: boolean
  result: NoticeExtractResult | null
  confirming: boolean
  error: string
  onCancel: () => void
  onConfirm: (drafts: NoticeDraft[]) => void
}

/**
 * 通知草稿确认弹窗。
 *
 * 与 TaskDraftModal 同理：**模型输出一律先给用户看一眼再落库**。
 * 标题可改——AI 提炼的「一句话核心」偶尔会抓错重点，让用户直接改比让他删了重来快。
 * 关联度和来源只展示不改：那是排序依据，用户改它没有意义，反而会打乱降权规则。
 */
export default function NoticeDraftModal({
  open,
  result,
  confirming,
  error,
  onCancel,
  onConfirm,
}: NoticeDraftModalProps) {
  const [selected, setSelected] = useState<boolean[]>([])
  const [titles, setTitles] = useState<string[]>([])

  // 结果变化时重置选择状态。默认全选：提炼出来的卡片绝大多数是用户想要的，
  // 让他逐条勾选是浪费时间——真正要做的动作是「去掉不想要的」。
  useEffect(() => {
    const cards = result?.cards ?? []
    setSelected(cards.map(() => true))
    setTitles(cards.map((card) => card.title))
  }, [result])

  const cards = result?.cards ?? []
  const chosenCount = selected.filter(Boolean).length

  const toggle = (index: number, on: boolean) => {
    setSelected((prev) => prev.map((value, i) => (i === index ? on : value)))
  }

  const setTitle = (index: number, value: string) => {
    setTitles((prev) => prev.map((v, i) => (i === index ? value : v)))
  }

  return (
    <Modal
      title="确认待阅通知"
      open={open}
      onCancel={onCancel}
      okText={`加入待阅（${chosenCount}）`}
      cancelText="取消"
      confirmLoading={confirming}
      okButtonProps={{ disabled: chosenCount === 0 }}
      onOk={() =>
        onConfirm(
          cards
            .map((card, index) => ({
              ...card,
              title: (titles[index] ?? card.title).trim() || card.title,
            }))
            .filter((_, index) => selected[index]),
        )
      }
      width={620}
      footer={
        /* 弹脚 3D 按钮：加入待阅（绿）/ 取消（蓝）；原生 button 避开旧 !important 规则 */
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="b-btn-3d blue"
            disabled={confirming}
            onClick={onCancel}
            style={FOOTER_BTN_STYLE}
          >
            取消
          </button>
          <button
            type="button"
            className="b-btn-3d"
            disabled={chosenCount === 0 || confirming}
            onClick={() =>
              onConfirm(
                cards
                  .map((card, index) => ({
                    ...card,
                    title: (titles[index] ?? card.title).trim() || card.title,
                  }))
                  .filter((_, index) => selected[index]),
              )
            }
            style={FOOTER_BTN_STYLE}
          >
            {confirming && <LoadingOutlined spin />}
            {`加入待阅（${chosenCount}）`}
          </button>
        </div>
      }
      destroyOnClose
    >
      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
        {result?.note && (
          <Typography.Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-soft)' }}>
            {result.note}
          </Typography.Text>
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{
              borderRadius: 'var(--b-radius-sm)',
              background: 'var(--b-red-soft)',
              border: '1px solid var(--b-line)',
            }}
          />
        )}
        {cards.length === 0 ? (
          <Typography.Text type="secondary" style={{ color: 'var(--b-ink-soft)' }}>
            没有提炼出通知卡片。
          </Typography.Text>
        ) : (
          cards.map((card, index) => (
            <div key={index} style={DRAFT_CARD_STYLE}>
              <Space align="start" style={{ width: '100%' }}>
                <Checkbox
                  checked={selected[index] ?? false}
                  onChange={(e) => toggle(index, e.target.checked)}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Space size={6} wrap style={{ marginBottom: 6 }}>
                    <span className="b-pill purple">AI 提炼</span>
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
                          fontSize: 12,
                          fontWeight: 800,
                          color: 'var(--b-ink-faint)',
                        }}
                      >
                        {card.keyTime.replace('T', ' ').slice(0, 16)}
                      </span>
                    )}
                  </Space>
                  <Input
                    value={titles[index] ?? card.title}
                    onChange={(e) => setTitle(index, e.target.value)}
                    size="small"
                  />
                  {card.summary && (
                    <div style={{ color: 'var(--b-ink-soft)', fontSize: 12, marginTop: 4 }}>
                      {card.summary}
                    </div>
                  )}
                  {card.requirement && (
                    <div style={{ color: 'var(--b-ink-soft)', fontSize: 12, marginTop: 2 }}>
                      要求：{card.requirement}
                    </div>
                  )}
                </div>
              </Space>
            </div>
          ))
        )}
      </Space>
    </Modal>
  )
}
