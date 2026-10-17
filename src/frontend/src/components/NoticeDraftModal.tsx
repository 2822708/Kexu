import { useEffect, useState } from 'react'
import { Alert, Checkbox, Input, Modal, Space, Tag, Typography } from 'antd'
import type { NoticeDraft, NoticeExtractResult } from '../types'

const RELEVANCE_LABELS: Record<number, string> = { 1: '强相关', 2: '可能相关', 3: '泛泛相关' }

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
      destroyOnClose
    >
      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
        {result?.note && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {result.note}
          </Typography.Text>
        )}
        {error && <Alert type="error" showIcon message={error} />}
        {cards.length === 0 ? (
          <Typography.Text type="secondary">没有提炼出通知卡片。</Typography.Text>
        ) : (
          cards.map((card, index) => (
            <div
              key={index}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                background: 'var(--bg-card)',
              }}
            >
              <Space align="start" style={{ width: '100%' }}>
                <Checkbox
                  checked={selected[index] ?? false}
                  onChange={(e) => toggle(index, e.target.checked)}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Space size={6} wrap style={{ marginBottom: 6 }}>
                    <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                      {card.source}
                    </Tag>
                    <Tag style={{ marginInlineEnd: 0 }}>
                      {RELEVANCE_LABELS[card.relevance] ?? '可能相关'}
                    </Tag>
                    {card.keyTime && (
                      <Tag color="volcano" style={{ marginInlineEnd: 0 }}>
                        {card.keyTime.replace('T', ' ').slice(0, 16)}
                      </Tag>
                    )}
                  </Space>
                  <Input
                    value={titles[index] ?? card.title}
                    onChange={(e) => setTitle(index, e.target.value)}
                    size="small"
                  />
                  {card.summary && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                      {card.summary}
                    </div>
                  )}
                  {card.requirement && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
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
