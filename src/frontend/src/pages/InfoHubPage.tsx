import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Dropdown, Empty, Space, Typography } from 'antd'
import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DatabaseOutlined,
  InboxOutlined,
  LeftOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { noticeApi } from '../api'
import { useApp } from '../store/AppContext'
import { useRewards } from '../store/RewardsContext'
import InfoDropZone from '../components/InfoDropZone'
import InfoQueryPanel from '../components/InfoQueryPanel'
import type { NoticeCard, NoticeStatus } from '../types'
import { dayjs } from '../utils/schedule'

const { Title, Text } = Typography

/** 浏览器本地存储用量估算（navigator.storage.estimate）；不可用时返回 null */
function useStorageEstimate(): { usage: number; quota: number } | null {
  const [info, setInfo] = useState<{ usage: number; quota: number } | null>(null)
  useEffect(() => {
    let alive = true
    void navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (alive && est.usage != null && est.quota != null) {
          setInfo({ usage: est.usage, quota: est.quota })
        }
      })
      .catch(() => {
        // 估算失败不提示：这只是个参考信息，不该打扰用户
      })
    return () => {
      alive = false
    }
  }, [])
  return info
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const STATUS_PILL: Record<NoticeStatus, { variant: string; label: string } | null> = {
  DONE: { variant: 'green', label: '已加入日程' },
  IGNORED: { variant: '', label: '已忽略' },
  PENDING: { variant: 'yellow', label: '待决定' },
}

/**
 * 信息处理中心（AI Campus Agent · 信息输入/解析/同步中枢）。
 *
 * 布局遵循设计方案：左右分栏 + 底部预览。
 * 左栏「信息收纳盒」拖拽/粘贴进材料，右栏「AI 查询中心」整理查询计划，
 * 底部横排最近 5 条解析结果，全部动作最终汇入首页三大板块与全局日程。
 *
 * 两条产品边界在本页显式兑现：
 * ① 不自动抓取任何群聊/邮箱/教务系统——材料只能由用户主动拖入或粘贴；
 * ② 文件在浏览器本地读取提取文字，原文件不保存；截图 OCR 与文本提炼
 *    经服务器转交已配置的 AI 服务（与导入浮球的提示一致）。
 */
export default function InfoHubPage() {
  const navigate = useNavigate()
  const { refreshAll } = useApp()
  const { earn } = useRewards()
  const [recent, setRecent] = useState<NoticeCard[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const storage = useStorageEstimate()

  const refreshRecent = useCallback(() => {
    setRecentLoading(true)
    noticeApi
      .recent(5)
      .then(setRecent)
      .catch((e: unknown) => setRecentError(e instanceof Error ? e.message : '预览加载失败'))
      .finally(() => setRecentLoading(false))
  }, [])

  useEffect(() => {
    refreshRecent()
  }, [refreshRecent])

  /** 加入日程：一条通知变成一个任务，是实打实的整理动作，给任务积分 */
  const handleJoined = useCallback(() => {
    earn('task')
    refreshRecent()
    void refreshAll()
  }, [earn, refreshRecent, refreshAll])

  /** 查询计划同步到待办：刷新全局数据（侧栏待办计数等） */
  const handlePlanApplied = useCallback(() => {
    void refreshAll()
  }, [refreshAll])

  return (
    <div className="info-hub" style={{ maxWidth: 1180, margin: '0 auto' }}>
      <style>{`
        .info-hub .info-hub-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 960px) {
          .info-hub .info-hub-grid { grid-template-columns: 1fr; }
        }
        .info-hub .info-recent-rail {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .info-hub .info-recent-card {
          flex: none;
          width: 230px;
          background: var(--bg-card);
          border-radius: var(--b-radius);
          box-shadow: var(--b-sh2);
          padding: 12px 14px;
        }
      `}</style>

      {/* ==================== 页头 ==================== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            className="icon-btn-round"
            title="返回主界面"
            onClick={() => navigate('/')}
            style={{ cursor: 'pointer' }}
          >
            <LeftOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <Title level={4} style={{ margin: 0, fontWeight: 800 }}>
              <InboxOutlined style={{ color: 'var(--b-green)' }} /> 信息处理中心
            </Title>
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              拖入或粘贴信息 → AI 提炼 → 确认后同步到日程与待办
            </Text>
          </div>
        </div>
        <Space size={8} wrap>
          {storage && (
            <span className="b-pill" style={{ background: 'var(--b-bg-soft)', color: 'var(--b-ink-soft)' }}>
              <DatabaseOutlined />
              本地缓存 {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
            </span>
          )}
          <Dropdown
            menu={{
              items: [
                { key: 'rules', icon: <SettingOutlined />, label: '解析规则与 AI 配置' },
                { key: 'remind', icon: <SettingOutlined />, label: '提醒偏好' },
              ],
              onClick: () => navigate('/settings'),
            }}
          >
            <Button size="small" icon={<SettingOutlined />} style={{ fontWeight: 800 }}>
              设置
            </Button>
          </Dropdown>
        </Space>
      </div>

      {/* ==================== 左右分栏 ==================== */}
      <div className="info-hub-grid">
        <InfoDropZone onNoticeCreated={refreshRecent} onJoinedSchedule={handleJoined} />
        <InfoQueryPanel onPlanApplied={handlePlanApplied} />
      </div>

      {/* ==================== 底部：最近解析预览 ==================== */}
      <Card
        size="small"
        title={
          <Space>
            <CloudUploadOutlined />
            <span>最近解析</span>
            <span className="b-pill blue">{recent.length}</span>
          </Space>
        }
        style={{ marginTop: 16, borderRadius: 'var(--b-radius)', boxShadow: 'var(--b-sh2)' }}
        loading={recentLoading}
      >
        {recentError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12, borderRadius: 'var(--b-radius-sm)' }}
            message={recentError}
            action={<Button size="small" onClick={refreshRecent}>重试</Button>}
          />
        )}
        {recent.length === 0 ? (
          <div style={{ background: 'var(--b-bg-soft)', borderRadius: 'var(--b-radius)', padding: '18px 12px' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" align="center" size={2}>
                  <span style={{ color: 'var(--b-ink-soft)' }}>还没有处理过信息</span>
                  <Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-faint)' }}>
                    从左侧拖入第一条通知，或粘贴一段群公告开始
                  </Text>
                </Space>
              }
              style={{ margin: '12px 0' }}
            />
          </div>
        ) : (
          <div className="info-recent-rail">
            {recent.map((card) => {
              const pill = STATUS_PILL[card.status]
              return (
                <div key={card.id} className="info-recent-card">
                  <Space size={6} wrap style={{ marginBottom: 6 }}>
                    <span className="b-pill blue">{card.source}</span>
                    {pill && (
                      <span
                        className={pill.variant ? `b-pill ${pill.variant}` : 'b-pill'}
                        style={pill.variant ? undefined : { background: 'var(--b-bg-soft)', color: 'var(--b-ink-faint)' }}
                      >
                        {card.status === 'DONE' && <CheckCircleFilled style={{ fontSize: 11 }} />}
                        {pill.label}
                      </span>
                    )}
                  </Space>
                  <div style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--b-ink)' }}>{card.title}</div>
                  {card.keyTime && (
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--b-ink-faint)', marginTop: 4 }}>
                      截止 {dayjs(card.keyTime).format('MM-DD HH:mm')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
