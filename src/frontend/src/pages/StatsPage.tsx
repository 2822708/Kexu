import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { statsApi } from '../api'
import type { ProposalFunnel, UsageDailyPoint, UsageSceneBreakdown, UsageStats } from '../types'

const { Text } = Typography

/** 时间窗口选项；服务端会夹到 [1, 365]，这里只给常用值 */
const DAY_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
]

/** token 数加千分位，读起来比一长串数字舒服 */
const withSeparator = (n: number) => n.toLocaleString('zh-CN')

/** 成本保留 4 位小数：单价是「元/百万 token」，单次调用成本通常在 0.001 元以下 */
const formatCost = (n: number, currency: string) =>
  `${currency === 'CNY' ? '¥' : ''}${n.toFixed(4)}`

/** 平均耗时；null 表示「无成功调用」，不显示成 0——0 会被读成「快得离谱」 */
const formatLatency = (ms: number | null) => (ms == null ? '—' : `${ms} ms`)

/** 耗时秒数 → 人话；超过 1 小时才用「小时」，否则用秒 */
const formatDecideSeconds = (s: number | null) => {
  if (s == null) return '—'
  if (s < 60) return `${s.toFixed(1)} 秒`
  if (s < 3600) return `${(s / 60).toFixed(1)} 分钟`
  return `${(s / 3600).toFixed(1)} 小时`
}

export default function StatsPage() {
  const [days, setDays] = useState(30)
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [funnel, setFunnel] = useState<ProposalFunnel | null>(null)
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErrMsg(null)
    try {
      // 两个端点互不依赖，并行取；一个失败不该拖垮整页，所以分开 catch
      const [usageData, funnelData] = await Promise.all([
        statsApi.usage(days),
        statsApi.proposals(),
      ])
      setUsage(usageData)
      setFunnel(funnelData)
    } catch (e) {
      setUsage(null)
      setFunnel(null)
      setErrMsg(e instanceof Error ? e.message : '加载失败')
      message.error('统计加载失败，稍后重试')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 每日趋势用纯 div 画柱状图，不引图表库。
   * 峰值取 max 而不是「取当天最大值硬编码」，否则换时间窗口后柱子会全部压扁。
   */
  const trend = useMemo(() => {
    const daily = usage?.daily ?? []
    const peak = Math.max(1, ...daily.map((d) => d.totalTokens))
    return { daily, peak }
  }, [usage])

  const sceneColumns: ColumnsType<UsageSceneBreakdown> = [
    {
      title: '场景',
      dataIndex: 'sceneLabel',
      render: (v: string, row) => (
        <Space size={6}>
          <span>{v}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.scene}
          </Text>
        </Space>
      ),
    },
    { title: '调用次数', dataIndex: 'callCount', align: 'right', render: withSeparator },
    {
      title: 'Token 合计',
      dataIndex: 'totalTokens',
      align: 'right',
      render: withSeparator,
    },
    {
      title: '估算成本',
      dataIndex: 'estimatedCost',
      align: 'right',
      render: (v: number) => formatCost(v, usage?.currency ?? 'CNY'),
    },
  ]

  const dailyColumns: ColumnsType<UsageDailyPoint> = [
    { title: '日期', dataIndex: 'date' },
    { title: '调用次数', dataIndex: 'callCount', align: 'right', render: withSeparator },
    {
      title: 'Token 合计',
      dataIndex: 'totalTokens',
      align: 'right',
      render: withSeparator,
    },
  ]

  const hasUsage = (usage?.callCount ?? 0) > 0
  const confirmPercent = funnel?.confirmRate ?? null

  return (
    <div>
      <div className="page-header">
        <h4>AI 用量统计</h4>
        <Space>
          <Segmented
            value={days}
            onChange={(v) => setDays(v as number)}
            options={DAY_OPTIONS}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </div>

      {errMsg && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="统计加载失败"
          description={errMsg}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      {!errMsg && !hasUsage && !loading && (
        <Empty
          style={{ marginTop: 48 }}
          description={
            <Space direction="vertical" align="center">
              <span>这段时间还没有 AI 调用记录</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                去「AI 助手」聊一句，或让 AI 解析一次课表，这里就会有数据了
              </Text>
            </Space>
          }
        />
      )}

      {hasUsage && usage && (
        <>
          <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title={
                    <Tooltip title="按后端配置的单价表估算，不是账单数字。调价后数值会变。">
                      <span>估算成本</span>
                    </Tooltip>
                  }
                  value={formatCost(usage.estimatedCost, usage.currency)}
                  valueStyle={{ fontSize: 22 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  近 {usage.days} 天
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="调用次数"
                  value={usage.callCount}
                  valueStyle={{ fontSize: 22 }}
                  suffix={
                    usage.errorCount > 0 ? (
                      <Text type="danger" style={{ fontSize: 12 }}>
                        / 失败 {usage.errorCount}
                      </Text>
                    ) : null
                  }
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  平均耗时 {formatLatency(usage.avgLatencyMs)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Token 合计"
                  value={usage.totalTokens}
                  valueStyle={{ fontSize: 22 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  入 {withSeparator(usage.promptTokens)} / 出{' '}
                  {withSeparator(usage.completionTokens)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Tooltip
                  title="已落库口径：读消息时的失效复核（STALE）不落库，所以这里的确认率是上界，真实值只会更低。"
                >
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                    提案确认率
                  </span>
                </Tooltip>
                <div style={{ marginTop: 6 }}>
                  {confirmPercent == null ? (
                    <Text type="secondary">暂无已决定提案</Text>
                  ) : (
                    <>
                      <Progress
                        type="dashboard"
                        percent={confirmPercent}
                        size={78}
                        status={confirmPercent < 50 ? 'exception' : 'normal'}
                      />
                    </>
                  )}
                </div>
              </Card>
            </Col>
          </Row>

          {/* 每日趋势：纯 div 柱状，避免为一张图引一个图表库 */}
          {trend.daily.length > 0 && (
            <Card size="small" title="每日 Token 用量" style={{ marginTop: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 2,
                  height: 120,
                  overflowX: 'auto',
                }}
              >
                {trend.daily.map((d) => (
                  <Tooltip key={d.date} title={`${d.date}：${d.callCount} 次 / ${withSeparator(d.totalTokens)} tokens`}>
                    <div
                      style={{
                        flex: '0 0 10px',
                        height: `${Math.max(4, (d.totalTokens / trend.peak) * 100)}%`,
                        background: 'var(--accent, #8b7355)',
                        borderRadius: 2,
                        opacity: 0.85,
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                峰值 {withSeparator(trend.peak)} tokens / 天
              </Text>
            </Card>
          )}

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} lg={14}>
              <Card size="small" title="分场景用量">
                <Table<UsageSceneBreakdown>
                  size="small"
                  rowKey="scene"
                  columns={sceneColumns}
                  dataSource={usage.scenes}
                  pagination={false}
                  locale={{ emptyText: '暂无数据' }}
                />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card size="small" title="提案漏斗">
                <Statistic
                  title="待确认"
                  value={funnel?.pendingCount ?? 0}
                  valueStyle={{ fontSize: 20 }}
                />
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已执行 {funnel?.executedCount ?? 0} · 已拒绝 {funnel?.rejectedCount ?? 0} · 已失效{' '}
                    {funnel?.staleCount ?? 0}
                  </Text>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    平均决定耗时 {formatDecideSeconds(funnel?.avgDecideSeconds ?? null)}
                  </Text>
                </div>
              </Card>
            </Col>
          </Row>

          <Card size="small" title="每日明细" style={{ marginTop: 12 }}>
            <Table<UsageDailyPoint>
              size="small"
              rowKey="date"
              columns={dailyColumns}
              dataSource={trend.daily}
              pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }}
              locale={{ emptyText: '暂无数据' }}
            />
          </Card>
        </>
      )}

      {!hasUsage && !errMsg && funnel && (funnel.pendingCount > 0 || funnel.decidedCount > 0) && (
        <Card size="small" title="提案漏斗" style={{ marginTop: 16 }}>
          <Space direction="vertical">
            <Text>
              待确认 <strong>{funnel.pendingCount}</strong> 条
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已执行 {funnel.executedCount} · 已拒绝 {funnel.rejectedCount} · 已失效 {funnel.staleCount}
            </Text>
          </Space>
        </Card>
      )}
    </div>
  )
}
