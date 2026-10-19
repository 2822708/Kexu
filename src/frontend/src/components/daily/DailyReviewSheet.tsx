import { useState } from 'react'
import { Alert, Button, Input, Modal, Radio, Space, Typography } from 'antd'
import type { DailyReview, DailyReviewContent } from '../../local/daily/types'
import type { DailyReviewFacts } from '../../local/daily/review'

interface Props {
  open: boolean
  date: string
  todayDate: string
  facts: DailyReviewFacts
  review?: DailyReview
  readOnly?: boolean
  saving?: boolean
  error?: string
  onClose: () => void
  onSave: (content: DailyReviewContent, facts: DailyReviewFacts) => Promise<void>
  onSaveDraft: (content: DailyReviewContent) => Promise<void>
  onRefreshFacts?: (facts: DailyReviewFacts) => Promise<void>
  onReturnToday?: () => void
  onViewYesterday?: () => void
}

const FEELINGS = ['很充实', '还可以', '有点累', '暂不评价']
const emptyContent: DailyReviewContent = { feeling: '', text: '', nextStep: '' }

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

/** Mounted only while open: refreshing facts never resets the user's in-progress writing. */
function ReviewEditor({
  date,
  todayDate,
  facts,
  review,
  readOnly = false,
  saving = false,
  error,
  onClose,
  onSave,
  onSaveDraft,
  onRefreshFacts,
  onReturnToday,
  onViewYesterday,
}: Props) {
  const initial = readOnly
    ? (review?.saved ?? emptyContent)
    : (review?.draft ?? review?.saved ?? emptyContent)
  const [content, setContent] = useState<DailyReviewContent>({
    feeling: initial.feeling,
    text: initial.text,
    nextStep: initial.nextStep,
  })
  const [lastWritten, setLastWritten] = useState<DailyReviewContent>(content)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [status, setStatus] = useState('')
  const isToday = date === todayDate
  const yesterday = new Date(`${todayDate}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const isYesterday = date === yesterday.toISOString().slice(0, 10)
  const locked = saving || busy
  const changed =
    content.feeling !== lastWritten.feeling ||
    content.text !== lastWritten.text ||
    content.nextStep !== lastWritten.nextStep
  const shownSummary = review?.saved?.summary ?? facts.summary
  const shownCounts = review?.saved?.facts ?? facts.counts
  const outdated = !!review?.saved && review.saved.fingerprint !== facts.fingerprint

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setLocalError('')
    try {
      await action()
      setStatus(success)
      return true
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '保存失败，输入内容已保留，请重试。')
      return false
    } finally {
      setBusy(false)
    }
  }

  const keepDraftAndClose = async () => {
    if (locked) return
    if (!readOnly && changed) {
      const ok = await run(() => onSaveDraft(content), '草稿已保留')
      if (!ok) return
      setLastWritten(content)
    }
    onClose()
  }

  const save = async () => {
    const ok = await run(() => onSave(content, facts), '回顾已保存')
    if (ok) setLastWritten(content)
  }

  const discardLocalEdits = () =>
    Modal.confirm({
      title: '放弃本次未保存的输入？',
      content: '只放弃当前窗口尚未保存的修改。已保存的回顾和另一窗口的内容保持不变。',
      okText: '放弃并关闭',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: onClose,
    })

  return (
    <Modal
      open
      title={`${isToday ? '今日回顾' : isYesterday ? '昨日回顾' : readOnly ? '历史回顾' : '每日回顾'} · ${formatDate(date)}`}
      onCancel={() => void keepDraftAndClose()}
      footer={null}
      width={560}
      className="daily-review-sheet"
      maskClosable={!locked}
      keyboard={!locked}
      closable={!locked}
      destroyOnHidden
      focusTriggerAfterClose
    >
      <div className="daily-review-content">
        {!isToday && !readOnly && (
          <Alert
            type="info"
            message={`新的一天已开始，正在编辑的内容仍保存到 ${date}。`}
            style={{ marginBottom: 12 }}
          />
        )}
        {readOnly && (
          <Typography.Paragraph type="secondary">只读查看这一天的记录。</Typography.Paragraph>
        )}
        {outdated && (
          <Alert
            type="info"
            showIcon
            message={
              readOnly
                ? '事实后来有更新，以下保留当时保存的小结。'
                : '事实有更新，小结保持上次保存的内容。'
            }
            action={
              !readOnly && onRefreshFacts ? (
                <Button
                  disabled={locked}
                  onClick={() =>
                    void run(() => onRefreshFacts(facts), '事实已刷新，感受与文字保持原样')
                  }
                >
                  刷新事实
                </Button>
              ) : undefined
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <section aria-labelledby="daily-review-facts-title">
          <h3 id="daily-review-facts-title">{isToday ? '看见今天的推进' : '这一天的推进'}</h3>
          <Typography.Paragraph className="daily-review-summary">
            {shownSummary}
          </Typography.Paragraph>
          {shownCounts.completed > 0 && (
            <p>
              完成任务 {shownCounts.completed} 项
              {shownCounts.backfillCompleted > 0
                ? `，其中补记 ${shownCounts.backfillCompleted} 项`
                : ''}
            </p>
          )}
          {shownCounts.priorityPlanned > 0 && (
            <p>
              曾选重点 {shownCounts.priorityCompleted} / {shownCounts.priorityPlanned} 项
              {shownCounts.priorityAdjusted > 0
                ? `，已调整 ${shownCounts.priorityAdjusted} 项`
                : ''}
            </p>
          )}
          {shownCounts.coursesConfirmed > 0 && (
            <p>确认参加课程 {shownCounts.coursesConfirmed} 次</p>
          )}
          {!review?.saved && readOnly && (
            <Typography.Paragraph type="secondary">这一天未保存个人回顾。</Typography.Paragraph>
          )}
        </section>
        {readOnly ? (
          <section aria-label="已保存的个人回顾">
            {review?.saved?.feeling && <p>感受：{review.saved.feeling}</p>}
            {review?.saved?.text && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {review.saved.text}
              </Typography.Paragraph>
            )}
            {review?.saved?.nextStep && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                留给下一天：{review.saved.nextStep}
              </Typography.Paragraph>
            )}
          </section>
        ) : (
          <>
            <fieldset
              className="daily-review-feelings"
              style={{ border: 0, padding: 0, margin: '20px 0' }}
            >
              <legend>今天感觉如何</legend>
              <Radio.Group
                value={content.feeling || undefined}
                onChange={(event) =>
                  setContent((previous) => ({ ...previous, feeling: event.target.value }))
                }
                disabled={locked}
              >
                <Space wrap>
                  {FEELINGS.map((feeling) => (
                    <Radio.Button
                      key={feeling}
                      value={feeling}
                      style={{ height: 44, lineHeight: '42px' }}
                    >
                      {feeling}
                    </Radio.Button>
                  ))}
                </Space>
              </Radio.Group>
            </fieldset>
            <label htmlFor="daily-review-note">留一句话（可选）</label>
            <Input.TextArea
              id="daily-review-note"
              value={content.text}
              onChange={(event) =>
                setContent((previous) => ({ ...previous, text: event.target.value }))
              }
              placeholder="今天值得肯定的是……"
              maxLength={2000}
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={locked}
              style={{ margin: '8px 0 16px', fontSize: 16 }}
            />
            <label htmlFor="daily-review-next">明天先做（可选，不会自动创建任务）</label>
            <Input
              id="daily-review-next"
              value={content.nextStep}
              onChange={(event) =>
                setContent((previous) => ({ ...previous, nextStep: event.target.value }))
              }
              maxLength={300}
              disabled={locked}
              style={{ margin: '8px 0 16px', minHeight: 44, fontSize: 16 }}
            />
            {outdated && (
              <Typography.Paragraph type="secondary">
                保存回顾时会一并采用当前事实。
              </Typography.Paragraph>
            )}
          </>
        )}
        {(localError || error) && (
          <Alert type="error" showIcon message={localError || error} style={{ marginBottom: 12 }} />
        )}
        <div role="status" aria-live="polite" style={{ minHeight: 24 }}>
          {status}
        </div>
        <Space wrap style={{ width: '100%', marginTop: 8 }}>
          {!readOnly && changed && (localError || error) && (
            <Button danger disabled={locked} onClick={discardLocalEdits} style={{ minHeight: 44 }}>
              放弃本次未保存修改并关闭
            </Button>
          )}
          {!readOnly && (
            <Button
              type="primary"
              loading={locked}
              onClick={() => void save()}
              style={{ minHeight: 44 }}
            >
              保存回顾
            </Button>
          )}
          <Button
            disabled={locked}
            onClick={() => void keepDraftAndClose()}
            style={{ minHeight: 44 }}
          >
            {readOnly ? '关闭' : '先放着'}
          </Button>
          {readOnly && onReturnToday && (
            <Button type="link" disabled={locked} onClick={onReturnToday} style={{ minHeight: 44 }}>
              返回今日
            </Button>
          )}
          {!readOnly && onViewYesterday && (
            <Button
              type="link"
              disabled={locked}
              onClick={async () => {
                if (changed && !(await run(() => onSaveDraft(content), '草稿已保留'))) return
                onViewYesterday()
              }}
              style={{ minHeight: 44 }}
            >
              查看昨日
            </Button>
          )}
        </Space>
      </div>
    </Modal>
  )
}

export default function DailyReviewSheet(props: Props) {
  return props.open ? (
    <ReviewEditor key={`${props.date}:${props.readOnly ? 'readonly' : 'edit'}`} {...props} />
  ) : null
}
