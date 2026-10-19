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

/** 统计卡片统一质感：白底 + 柔影 + 大圆角（明亮风） */
const statCardStyle = {
  borderRadius: 'var(--b-radius)',
  boxShadow: 'var(--b-sh2)',
} as const

/** 卡片标题前的色条点缀（明亮风分区标识） */
function SectionTitle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 4,
          height: 15,
          borderRadius: 99,
          background: color,
          flex: 'none',
        }}
      />
      {children}
    </span>
  )
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
        <div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: 'var(--b-ink)',
              letterSpacing: 0.5,
              lineHeight: 1.2,
            }}
          >
            AI 用量统计
          </div>
          <div style={{ marginTop: 3, fontSize: 13, fontWeight: 800, color: 'var(--b-ink-soft)' }}>
            看看 AI 学长最近帮你干了多少活
          </div>
        </div>
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
              <Card size="small" style={statCardStyle}>
                <Statistic
                  title={
                    <Tooltip title="按后端配置的单价表估算，不是账单数字。调价后数值会变。">
                      <span>估算成本</span>
                    </Tooltip>
                  }
                  value={formatCost(usage.estimatedCost, usage.currency)}
                  valueStyle={{ fontSize: 22, fontWeight: 900, color: 'var(--b-yellow-ink)' }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  近 {usage.days} 天
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle}>
                <Statistic
                  title="调用次数"
                  value={usage.callCount}
                  valueStyle={{ fontSize: 22, fontWeight: 900, color: 'var(--b-green-ink)' }}
                  suffix={
                    usage.errorCount > 0 ? (
                      <span className="b-pill red" style={{ fontSize: 11 }}>
                        失败 {usage.errorCount}
                      </span>
                    ) : null
                  }
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  平均耗时 {formatLatency(usage.avgLatencyMs)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle}>
                <Statistic
                  title="Token 合计"
                  value={usage.totalTokens}
                  valueStyle={{ fontSize: 22, fontWeight: 900, color: 'var(--b-blue-ink)' }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  入 {withSeparator(usage.promptTokens)} / 出{' '}
                  {withSeparator(usage.completionTokens)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle}>
                <Tooltip title="System Prompt 的固定部分（人格 + 协议）被上游缓存复用，命中部分按更低的输入价计费。只统计上游确实上报了缓存字段的调用——不支持的 provider 不进分母。">
                  <span style={{ fontSize: 14, color: 'var(--b-ink-soft)' }}>缓存命中</span>
                </Tooltip>
                <div style={{ marginTop: 6 }}>
                  {usage.cacheHitRate == null ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      当前服务未上报缓存
                    </Text>
                  ) : (
                    <Progress
                      type="dashboard"
                      percent={Math.round(usage.cacheHitRate * 100)}
                      size={78}
                      strokeColor="var(--b-blue)"
                    />
                  )}
                </div>
                {usage.cacheSavedCny > 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    省 {formatCost(usage.cacheSavedCny, usage.currency)}
                  </Text>
                )}
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small" style={statCardStyle}>
                <Tooltip
                  title="已落库口径：读消息时的失效复核（STALE）不落库，所以这里的确认率是上界，真实值只会更低。"
                >
                  <span style={{ fontSize: 14, color: 'var(--b-ink-soft)' }}>提案确认率</span>
                </Tooltip>
                <div style={{ marginTop: 6 }}>
                  {confirmPercent == null ? (
                    <Text type="secondary">暂无已决定提案</Text>
                  ) : (
                    <Progress
                      type="dashboard"
                      percent={confirmPercent}
                      size={78}
                      status={confirmPercent < 50 ? 'exception' : 'normal'}
                      strokeColor={confirmPercent < 50 ? 'var(--b-red)' : 'var(--b-green)'}
                    />
                  )}
                </div>
              </Card>
            </Col>
          </Row>

          {/*
            月度预算（成本治理 P0-2）。未配预算时后端返回 null，这里整块不渲染——
            显示「不限 / 不限 / 不限」这种空卡片比不显示更糟，会让人以为额度没生效。

            分场景分别显示是因为「对话超限不该让课表解析一起挂」：用户需要能看出
            到底是哪一项超了，而不是只知道「AI 不能用了」。
          */}
          {usage.budget && (
            <Card
              size="small"
              title={
                <SectionTitle color="var(--b-yellow)">本月预算</SectionTitle>
              }
              style={{ marginTop: 12, ...statCardStyle }}
            >
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Statistic
                    title="已用"
                    value={formatCost(usage.budget.usedCny, usage.currency)}
                    valueStyle={{ fontSize: 20, fontWeight: 900, color: 'var(--b-blue-ink)' }}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="全局额度"
                    value={
                      usage.budget.monthlyLimitCny == null
                        ? '不限'
                        : formatCost(usage.budget.monthlyLimitCny, usage.currency)
                    }
                    valueStyle={{ fontSize: 20, fontWeight: 900 }}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="剩余"
                    value={
                      usage.budget.remainingCny == null
                        ? '不限'
                        : formatCost(usage.budget.remainingCny, usage.currency)
                    }
                    valueStyle={{
                      fontSize: 20,
                      fontWeight: 900,
                      color: usage.budget.blocked ? 'var(--b-red-ink)' : 'var(--b-green-ink)',
                    }}
                  />
                </Col>
                <Col xs={12} md={6}>
                  <Statistic
                    title="状态"
                    value={usage.budget.blocked ? '已熔断' : '正常'}
                    valueStyle={{
                      fontSize: 20,
                      fontWeight: 900,
                      color: usage.budget.blocked ? 'var(--b-red-ink)' : 'var(--b-green-ink)',
                    }}
                  />
                </Col>
              </Row>

              {usage.budget.scenes.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {usage.budget.scenes.map((s) => (
                    <div key={s.scene} style={{ marginBottom: 8 }}>
                      <Space size={8} style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Text style={{ fontSize: 13 }}>{s.sceneLabel}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatCost(s.usedCny, usage.currency)} /{' '}
                          {formatCost(s.limitCny, usage.currency)}
                          {s.exceeded && (
                            <span className="b-pill red" style={{ marginInlineStart: 6, fontSize: 11 }}>
                              已用完
                            </span>
                          )}
                        </Text>
                      </Space>
                      <Progress
                        percent={Math.min(100, Math.round((s.usedCny / s.limitCny) * 100))}
                        size="small"
                        status={s.exceeded ? 'exception' : 'normal'}
                        strokeColor={s.exceeded ? 'var(--b-red)' : 'var(--b-green)'}
                        showInfo={false}
                      />
                    </div>
                  ))}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    某一个场景用完只停该场景，其它功能照常可用；额度每月 1 号自动归零。
                  </Text>
                </div>
              )}
            </Card>
          )}

          {/* 每日趋势：纯 div 柱状，避免为一张图引一个图表库 */}
          {trend.daily.length > 0 && (
            <Card
              size="small"
              title={<SectionTitle color="var(--b-green)">每日 Token 用量</SectionTitle>}
              style={{ marginTop: 12, ...statCardStyle }}
            >
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
                        background: 'linear-gradient(180deg, var(--b-green), var(--b-green-deep))',
                        borderRadius: 3,
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
              <Card
                size="small"
                title={<SectionTitle color="var(--b-blue)">分场景用量</SectionTitle>}
                style={statCardStyle}
              >
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
              <Card
                size="small"
                title={<SectionTitle color="var(--b-purple)">提案漏斗</SectionTitle>}
                style={statCardStyle}
              >
                <Statistic
                  title="待确认"
                  value={funnel?.pendingCount ?? 0}
                  valueStyle={{ fontSize: 20, fontWeight: 900, color: 'var(--b-purple-ink)' }}
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

          <Card
            size="small"
            title={<SectionTitle color="var(--b-ink-faint)">每日明细</SectionTitle>}
            style={{ marginTop: 12, ...statCardStyle }}
          >
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
        <Card
          size="small"
          title={<SectionTitle color="var(--b-purple)">提案漏斗</SectionTitle>}
          style={{ marginTop: 16, ...statCardStyle }}
        >
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
