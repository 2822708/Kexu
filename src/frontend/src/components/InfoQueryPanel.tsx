import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { Dayjs } from 'dayjs'
import {
  BellOutlined,
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  DeleteOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { aiApi, todoApi } from '../api'
import type { QueryCategory, QueryPlan, QueryPlanPhase, QuerySubscription } from '../types'
import { WEEK_DAY_NAMES, dayjs } from '../utils/schedule'

const { Text } = Typography

/* ==================== 常量 ==================== */

const HISTORY_KEY = 'timetable.queryHistory.v1'
const SUBS_KEY = 'timetable.querySubs.v1'
/** 历史只留最近 8 条 */
const HISTORY_LIMIT = 8
/** 锚点日默认：今天 + 7 天 */
const DEFAULT_ANCHOR_DAYS = 7

const CATEGORY_ORDER: QueryCategory[] = ['COMPETITION', 'RECRUIT', 'ACADEMIC', 'LECTURE']

const CATEGORY_META: Record<
  QueryCategory,
  { label: string; short: string; pill: string; placeholder: string }
> = {
  COMPETITION: {
    label: '竞赛查询',
    short: '竞赛',
    pill: 'purple',
    placeholder: '如 全国大学生电子设计竞赛',
  },
  RECRUIT: {
    label: '校招实习',
    short: '校招',
    pill: 'blue',
    placeholder: '如 互联网公司暑期实习',
  },
  ACADEMIC: {
    label: '教务政策',
    short: '教务',
    pill: 'green',
    placeholder: '如 转专业 绩点要求',
  },
  LECTURE: {
    label: '讲座活动',
    short: '讲座',
    pill: 'yellow',
    placeholder: '如 人工智能前沿讲座',
  },
}

/* ==================== localStorage 安全读写（try/catch 静默降级） ==================== */

interface HistoryItem {
  category: QueryCategory
  keyword: string
  at: string
}

function isQueryCategory(v: unknown): v is QueryCategory {
  return v === 'COMPETITION' || v === 'RECRUIT' || v === 'ACADEMIC' || v === 'LECTURE'
}

/** 读取查询历史：存储不可用 / JSON 损坏 / 结构不符时都静默返回空数组 */
function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items: HistoryItem[] = []
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue
      const { category, keyword, at } = it as Partial<HistoryItem>
      if (!isQueryCategory(category) || typeof keyword !== 'string' || !keyword.trim()) continue
      items.push({
        category,
        keyword,
        at: typeof at === 'string' ? at : new Date().toISOString(),
      })
      if (items.length >= HISTORY_LIMIT) break
    }
    return items
  } catch {
    return []
  }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  } catch {
    // 隐私模式 / 容量已满：历史只是便利功能，静默降级，不阻断主流程
  }
}

/** 读取订阅列表：同上，逐条清洗，缺字段给兜底值 */
function loadSubs(): QuerySubscription[] {
  try {
    const raw = localStorage.getItem(SUBS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const subs: QuerySubscription[] = []
    for (const it of parsed) {
      if (!it || typeof it !== 'object') continue
      const s = it as Partial<QuerySubscription>
      if (!isQueryCategory(s.category) || typeof s.keyword !== 'string' || !s.keyword.trim()) continue
      subs.push({
        id: typeof s.id === 'string' && s.id ? s.id : `qsub_${Date.now().toString(36)}`,
        category: s.category,
        keyword: s.keyword,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
        lastMatchedAt: typeof s.lastMatchedAt === 'string' ? s.lastMatchedAt : undefined,
      })
    }
    return subs
  } catch {
    return []
  }
}

function saveSubs(subs: QuerySubscription[]): void {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs))
  } catch {
    // 同上：静默降级
  }
}

/** 订阅 id：时间戳 + 随机后缀，同一毫秒多次订阅也不撞 */
function makeSubId(): string {
  return `qsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** leadDays → 文案：正数=提前，0=锚点日当天，负数=锚点日之后 */
function leadLabel(leadDays: number): string {
  if (leadDays > 0) return `建议提前 ${leadDays} 天`
  if (leadDays === 0) return '锚点日当天'
  return `锚点日后 ${-leadDays} 天`
}

/* ==================== 小分区标题 ==================== */

function SectionTitle({ icon, title, extra }: { icon: ReactNode; title: string; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 10,
      }}
    >
      <Space size={6}>
        {icon}
        <Text strong style={{ fontSize: 13.5, color: 'var(--b-ink)' }}>
          {title}
        </Text>
      </Space>
      {extra}
    </div>
  )
}

/* ==================== 主组件 ==================== */

export interface InfoQueryPanelProps {
  /** 计划按锚点日同步到待办后调用（宿主刷新全局数据） */
  onPlanApplied?: () => void
}

/**
 * AI 主动查询中心（信息处理中心右栏）。
 *
 * 边界（项目红线，UI 文案已显式声明）：本组件**不做任何自动检索/爬取**——
 * 不爬教务系统、不监听群聊。AI 的职责只是把「怎么查这件事」整理成结构化计划
 * （去哪查、查什么、关键节点怎么排），具体动态由用户按计划自己去官方渠道查。
 * 所有文案均不声称「已获取最新动态」「已检索到公告」。
 */
export default function InfoQueryPanel({ onPlanApplied }: InfoQueryPanelProps) {
  const [category, setCategory] = useState<QueryCategory>('COMPETITION')
  const [keyword, setKeyword] = useState('')
  const [plan, setPlan] = useState<QueryPlan | null>(null)
  /** 生成当前计划时实际使用的分类与关键词（用户之后改 tab 不影响同步标题） */
  const [planCategory, setPlanCategory] = useState<QueryCategory>('COMPETITION')
  const [planKeyword, setPlanKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs().add(DEFAULT_ANCHOR_DAYS, 'day'))
  /** 每阶段是否同步到待办，与 plan.phases 等长；新计划重置为全选 */
  const [checked, setChecked] = useState<boolean[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [subs, setSubs] = useState<QuerySubscription[]>(loadSubs)

  const isSubscribed = subs.some((s) => s.category === planCategory && s.keyword === planKeyword)
  const selectedCount = plan ? plan.phases.filter((_, i) => checked[i] !== false).length : 0

  /** 生成查询计划：AI 只整理「怎么查」，不检索外部渠道 */
  const runQuery = useCallback(async (cat: QueryCategory, kw: string) => {
    const trimmed = kw.trim()
    if (!trimmed) {
      message.warning('先输入一个查询关键词，AI 才好整理计划')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await aiApi.queryPlan({ category: cat, keyword: trimmed })
      setPlan(result)
      setPlanCategory(cat)
      setPlanKeyword(trimmed)
      setChecked(result.phases.map(() => true))
      setSyncError(null)
      // 历史：同分类同关键词去重后置顶，最多 8 条
      setHistory((prev) => {
        const next = [
          { category: cat, keyword: trimmed, at: new Date().toISOString() },
          ...prev.filter((h) => !(h.category === cat && h.keyword === trimmed)),
        ].slice(0, HISTORY_LIMIT)
        saveHistory(next)
        return next
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : '生成查询计划失败，请稍后重试'
      setError(
        /尚未配置|503/.test(raw)
          ? 'AI 尚未配置，暂时不能生成查询计划——可先到「设置」页配置 AI 服务后再试。'
          : raw,
      )
    } finally {
      setBusy(false)
    }
  }, [])

  /** 点击历史条目：回填分类 + 关键词，并一键重新生成 */
  const applyHistory = useCallback(
    (item: HistoryItem) => {
      setCategory(item.category)
      setKeyword(item.keyword)
      void runQuery(item.category, item.keyword)
    },
    [runQuery],
  )

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
    message.success('已清空查询历史')
  }, [])

  /** 订阅当前计划：同分类同关键词不重复订阅 */
  const subscribe = useCallback(() => {
    const kw = planKeyword.trim()
    if (!kw) return
    if (subs.some((s) => s.category === planCategory && s.keyword === kw)) {
      message.info('这个查询已经在订阅列表里了')
      return
    }
    const next = [
      { id: makeSubId(), category: planCategory, keyword: kw, createdAt: new Date().toISOString() },
      ...subs,
    ]
    setSubs(next)
    saveSubs(next)
    message.success('已订阅，之后可在本面板一键重新生成计划')
  }, [subs, planCategory, planKeyword])

  const removeSub = useCallback((id: string) => {
    setSubs((prev) => {
      const next = prev.filter((s) => s.id !== id)
      saveSubs(next)
      return next
    })
  }, [])

  /**
   * 按锚点日同步到待办：每条勾选阶段生成一条 todo。
   * ddl = 锚点日 + leadDays，格式与 TodosPage 一致（后端同款解析）。
   */
  const syncToTodos = useCallback(async () => {
    if (!plan || plan.phases.length === 0) {
      message.warning('当前计划没有可同步的阶段')
      return
    }
    const picked = plan.phases
      .map((phase, i) => ({ phase, on: checked[i] !== false }))
      .filter((x) => x.on)
    if (picked.length === 0) {
      message.warning('先勾选至少一个阶段')
      return
    }
    setSyncing(true)
    setSyncError(null)
    const results = await Promise.allSettled(
      picked.map(({ phase }: { phase: QueryPlanPhase }) =>
        todoApi.create({
          title: `${planKeyword.trim()} · ${phase.name}`,
          ddl: dayjs(anchor).add(phase.leadDays, 'day').format('YYYY-MM-DDTHH:mm:ss'),
        }),
      ),
    )
    const okCount = results.filter((r) => r.status === 'fulfilled').length
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    setSyncing(false)
    if (okCount === 0) {
      setSyncError(
        rejected && rejected.reason instanceof Error
          ? rejected.reason.message
          : '同步失败，请稍后重试',
      )
      return
    }
    if (rejected) {
      message.warning(`已创建 ${okCount} 条待办，其余 ${picked.length - okCount} 条创建失败`)
    } else {
      message.success(`已按锚点日创建 ${okCount} 条待办`)
    }
    onPlanApplied?.()
  }, [plan, checked, anchor, planKeyword, onPlanApplied])

  return (
    <div className="info-query">
      <style>{`
        .info-query .ant-card { border-radius: var(--b-radius); box-shadow: var(--b-sh2); }
        .info-query .ant-input:focus,
        .info-query .ant-input-focused {
          border-color: var(--b-blue);
          box-shadow: 0 0 0 2px var(--b-blue-soft);
        }
        .info-query .ant-picker:hover,
        .info-query .ant-picker-focused { border-color: var(--b-blue); }
        .info-query .ant-picker-focused { box-shadow: 0 0 0 2px var(--b-blue-soft); }
        .info-query .ant-checkbox-checked .ant-checkbox-inner {
          background: var(--b-blue);
          border-color: var(--b-blue);
        }
        .info-query .ant-checkbox-checked .ant-checkbox-inner::after { border-color: #fff; }
        .info-query .ant-alert {
          border: none !important;
          border-radius: var(--b-radius-sm) !important;
        }
        .info-query .ant-alert-error { background: var(--b-red-soft) !important; }
        .info-query .ant-alert-error .ant-alert-icon { color: var(--b-red-ink) !important; }
        .info-query .ant-alert-info { background: var(--b-blue-soft) !important; }
        .info-query .ant-alert-info .ant-alert-icon { color: var(--b-blue-ink) !important; }
        .info-query .b-btn-3d:disabled { opacity: 0.6; cursor: not-allowed; }
        /* 分类标签：自绘 pill，选中=晴空蓝实色 + 按压立体感 */
        .iq-tab-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .iq-tab {
          border: none;
          cursor: pointer;
          font-family: var(--b-font);
          font-weight: 900;
          font-size: 13px;
          padding: 7px 14px;
          border-radius: 99px;
          background: var(--b-bg-soft);
          color: var(--b-ink-soft);
          box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.05);
          transition: transform 0.15s, box-shadow 0.15s, background 0.15s, color 0.15s;
        }
        .iq-tab:hover { color: var(--b-ink); }
        .iq-tab.on {
          background: var(--b-blue);
          color: #fff;
          box-shadow: var(--b-hi-top), var(--b-thick-bottom), var(--b-sh1);
        }
        .iq-tab:active { transform: translateY(2px); }
        .iq-tab.on:active { box-shadow: var(--b-sh1); }
        /* 阶段时间线 */
        .iq-phase { display: flex; gap: 10px; }
        .iq-rail { position: relative; width: 14px; flex: none; display: flex; justify-content: center; }
        .iq-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--b-blue);
          box-shadow: 0 0 0 3px var(--b-blue-soft);
          margin-top: 4px;
          flex: none;
        }
        .iq-phase:not(:last-child) .iq-rail::after {
          content: '';
          position: absolute;
          top: 20px;
          bottom: -6px;
          width: 2px;
          background: var(--b-line);
          border-radius: 2px;
        }
        .iq-phase-body { flex: 1; min-width: 0; padding-bottom: 12px; }
        .iq-phase:last-child .iq-phase-body { padding-bottom: 0; }
        /* 历史条目 */
        .iq-hist-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          border: none;
          cursor: pointer;
          text-align: left;
          background: var(--b-bg-soft);
          border-radius: var(--b-radius-sm);
          padding: 8px 10px;
          font-family: var(--b-font);
          transition: background 0.15s, transform 0.15s;
        }
        .iq-hist-item:hover { background: var(--b-blue-soft); }
        .iq-hist-item:active { transform: translateY(1px); }
      `}</style>

      <Card
        size="small"
        title={
          <Space>
            <SearchOutlined style={{ color: 'var(--b-blue)' }} />
            <span>AI 主动查询中心</span>
          </Space>
        }
        style={{ borderRadius: 'var(--b-radius)', boxShadow: 'var(--b-sh2)' }}
      >
        {/* ==================== 边界声明：不自动检索 ==================== */}
        <div
          style={{
            background: 'var(--b-blue-soft)',
            borderRadius: 'var(--b-radius-sm)',
            padding: '10px 12px',
            display: 'flex',
            gap: 8,
          }}
        >
          <InfoCircleOutlined style={{ color: 'var(--b-blue-ink)', marginTop: 2 }} />
          <Text style={{ fontSize: 12, color: 'var(--b-blue-ink)', fontWeight: 800, lineHeight: 1.6 }}>
            本中心不抓取教务系统、不监听群聊。AI 只把「怎么查」整理成计划——去哪查、查什么、节点怎么排；最新动态请按计划到官方渠道自行查看。
          </Text>
        </div>

        {/* ==================== 分类标签 ==================== */}
        <div className="iq-tab-row" style={{ marginTop: 12 }}>
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              className={`iq-tab${c === category ? ' on' : ''}`}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_META[c].label}
            </button>
          ))}
        </div>

        {/* ==================== 搜索区 ==================== */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Input
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void runQuery(category, keyword)}
            placeholder={CATEGORY_META[category].placeholder}
            maxLength={100}
            prefix={<SearchOutlined style={{ color: 'var(--b-ink-faint)' }} />}
          />
          <button
            type="button"
            className="b-btn-3d blue"
            disabled={busy}
            onClick={() => void runQuery(category, keyword)}
            style={{ flex: 'none', fontSize: 13.5, padding: '8px 16px' }}
          >
            <ThunderboltOutlined />
            {busy ? '整理中…' : '生成查询计划'}
          </button>
        </div>

        {error && (
          <Alert
            type="error"
            showIcon
            closable
            onClose={() => setError(null)}
            style={{ marginTop: 12 }}
            message={error}
          />
        )}

        {/* ==================== 查询计划 ==================== */}
        {plan ? (
          <div style={{ marginTop: 14 }}>
            {/* goal + 订阅 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <Text strong style={{ fontSize: 14.5, color: 'var(--b-ink)', lineHeight: 1.5 }}>
                  {plan.goal || '（AI 未给出明确目标，可直接参考下面的渠道与阶段安排）'}
                </Text>
                <div style={{ fontSize: 11, color: 'var(--b-ink-faint)', marginTop: 3 }}>
                  AI 整理的查询计划 · 非实时检索结果
                </div>
              </div>
              {isSubscribed ? (
                <span className="b-pill green" style={{ flex: 'none' }}>
                  <CheckOutlined style={{ fontSize: 11 }} />
                  已订阅
                </span>
              ) : (
                <Tooltip title="订阅只在本地记录：方便之后一键重新生成计划（不做后台推送，也不会自动替你查）">
                  <button
                    type="button"
                    className="b-btn-3d blue"
                    onClick={subscribe}
                    style={{ flex: 'none', fontSize: 12.5, padding: '6px 12px' }}
                  >
                    <BellOutlined />
                    订阅更新
                  </button>
                </Tooltip>
              )}
            </div>

            {/* channels：只是「去哪查」的名称建议 */}
            {plan.channels.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <SectionTitle
                  icon={<CompassOutlined style={{ color: 'var(--b-blue)' }} />}
                  title="建议查询渠道"
                />
                <Space size={6} wrap>
                  {plan.channels.map((ch, i) => (
                    <span key={`${ch}-${i}`} className="b-pill blue">
                      <CompassOutlined style={{ fontSize: 11 }} />
                      {ch}
                    </span>
                  ))}
                </Space>
                <div style={{ fontSize: 11, color: 'var(--b-ink-faint)', marginTop: 6 }}>
                  以上是「去哪查」的建议，具体内容请到对应官方渠道查看。
                </div>
              </div>
            )}

            {/* watchouts：盯办点 */}
            {plan.watchouts.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  background: 'var(--b-yellow-soft)',
                  borderRadius: 'var(--b-radius-sm)',
                  padding: '10px 12px',
                }}
              >
                <SectionTitle
                  icon={<WarningOutlined style={{ color: 'var(--b-yellow-ink)' }} />}
                  title="盯办点"
                />
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--b-yellow-ink)' }}>
                  {plan.watchouts.map((w, i) => (
                    <li key={`${w}-${i}`} style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.7 }}>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* phases：阶段时间线（日期按锚点日推算） */}
            {plan.phases.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <SectionTitle
                  icon={<ClockCircleOutlined style={{ color: 'var(--b-purple)' }} />}
                  title="阶段规划"
                  extra={
                    <Text style={{ fontSize: 11, color: 'var(--b-ink-faint)' }}>日期按下方锚点日推算</Text>
                  }
                />
                <div>
                  {plan.phases.map((phase, i) => {
                    const d = dayjs(anchor).add(phase.leadDays, 'day')
                    return (
                      <div className="iq-phase" key={`${phase.name}-${i}`}>
                        <div className="iq-rail">
                          <span className="iq-dot" />
                        </div>
                        <div className="iq-phase-body">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Checkbox
                              checked={checked[i] !== false}
                              onChange={() =>
                                setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))
                              }
                            />
                            <Text strong style={{ fontSize: 13, color: 'var(--b-ink)' }}>
                              {phase.name}
                            </Text>
                            <span className="b-pill purple">{leadLabel(phase.leadDays)}</span>
                          </div>
                          {phase.hint && (
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--b-ink-soft)',
                                marginTop: 3,
                                lineHeight: 1.6,
                              }}
                            >
                              {phase.hint}
                            </div>
                          )}
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11.5,
                              fontWeight: 800,
                              color: 'var(--b-ink-faint)',
                              marginTop: 3,
                            }}
                          >
                            <CalendarOutlined />
                            {d.format('YYYY-MM-DD')} {WEEK_DAY_NAMES[d.isoWeekday() - 1]}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* note：模型备注 */}
            {plan.note && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--b-ink-faint)', lineHeight: 1.6 }}>
                备注：{plan.note}
              </div>
            )}

            {/* ==================== 同步到待办 ==================== */}
            {plan.phases.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  background: 'var(--b-bg-soft)',
                  borderRadius: 'var(--b-radius)',
                  padding: '12px 14px',
                }}
              >
                <SectionTitle
                  icon={<CalendarOutlined style={{ color: 'var(--b-blue)' }} />}
                  title="同步到待办"
                  extra={
                    <Text style={{ fontSize: 11, color: 'var(--b-ink-faint)' }}>
                      已选 {selectedCount} / {plan.phases.length} 个阶段
                    </Text>
                  }
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--b-ink-soft)' }}>锚点日</Text>
                  <DatePicker
                    value={anchor}
                    onChange={(d) => setAnchor(d ?? dayjs().add(DEFAULT_ANCHOR_DAYS, 'day'))}
                    allowClear={false}
                    format="YYYY-MM-DD"
                    style={{ width: 150 }}
                  />
                  <button
                    type="button"
                    className="b-btn-3d blue"
                    disabled={syncing}
                    onClick={() => void syncToTodos()}
                    style={{ fontSize: 13, padding: '7px 14px' }}
                  >
                    <CalendarOutlined />
                    {syncing ? '同步中…' : '同步到待办'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--b-ink-faint)', marginTop: 6, lineHeight: 1.6 }}>
                  每个勾选阶段生成一条待办：标题为「关键词 · 阶段名」，截止时间为锚点日按「建议提前天数」推算。
                </div>
                {syncError && (
                  <Alert
                    type="error"
                    showIcon
                    closable
                    onClose={() => setSyncError(null)}
                    style={{ marginTop: 8 }}
                    message={syncError}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          !error && (
            <div
              style={{
                background: 'var(--b-bg-soft)',
                borderRadius: 'var(--b-radius)',
                padding: '16px 12px',
                marginTop: 12,
              }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" align="center" size={2}>
                    <span style={{ color: 'var(--b-ink-soft)' }}>还没有查询计划</span>
                    <Text type="secondary" style={{ fontSize: 12, color: 'var(--b-ink-faint)' }}>
                      输入关键词，AI 会整理一份「去哪查、查什么、节点怎么排」的计划
                    </Text>
                  </Space>
                }
                style={{ margin: '12px 0' }}
              />
            </div>
          )
        )}

        {/* ==================== 查询历史 ==================== */}
        <div style={{ marginTop: 16, borderTop: '2px solid var(--b-line)', paddingTop: 14 }}>
          <SectionTitle
            icon={<HistoryOutlined style={{ color: 'var(--b-purple)' }} />}
            title="查询历史"
            extra={
              history.length > 0 ? (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={clearHistory}
                  style={{ fontSize: 12, fontWeight: 800 }}
                >
                  清空
                </Button>
              ) : undefined
            }
          />
          {history.length === 0 ? (
            <Text style={{ fontSize: 12, color: 'var(--b-ink-faint)' }}>
              还没有查询记录，生成一次计划后会出现在这里。
            </Text>
          ) : (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {history.map((h, i) => (
                <Tooltip key={`${h.category}-${h.keyword}-${i}`} title="点击回填并重新生成">
                  <button type="button" className="iq-hist-item" onClick={() => applyHistory(h)}>
                    <span
                      className={`b-pill ${CATEGORY_META[h.category].pill}`}
                      style={{ flex: 'none' }}
                    >
                      {CATEGORY_META[h.category].short}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12.5,
                        fontWeight: 800,
                        color: 'var(--b-ink)',
                      }}
                    >
                      {h.keyword}
                    </span>
                    <span style={{ flex: 'none', fontSize: 11, color: 'var(--b-ink-faint)' }}>
                      {dayjs(h.at).format('MM-DD HH:mm')}
                    </span>
                  </button>
                </Tooltip>
              ))}
            </Space>
          )}
        </div>

        {/* ==================== 订阅 ==================== */}
        <div style={{ marginTop: 16, borderTop: '2px solid var(--b-line)', paddingTop: 14 }}>
          <SectionTitle
            icon={<BellOutlined style={{ color: 'var(--b-yellow)' }} />}
            title="我的订阅"
            extra={
              subs.length > 0 ? (
                <span className="b-pill" style={{ background: 'var(--b-bg-soft)', color: 'var(--b-ink-faint)' }}>
                  {subs.length}
                </span>
              ) : undefined
            }
          />
          <Text style={{ fontSize: 11.5, color: 'var(--b-ink-faint)', lineHeight: 1.6 }}>
            订阅只在本地记录：把这条查询收藏在这里，之后随时一键重新生成计划。V1 不做后台推送，也不会自动替你查。点击关键词可回填搜索框。
          </Text>
          {subs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--b-ink-faint)', marginTop: 8 }}>
              还没有订阅。生成计划后点「订阅更新」，即可把这条查询收藏在这里。
            </div>
          ) : (
            <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
              {subs.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--b-bg-soft)',
                    borderRadius: 'var(--b-radius-sm)',
                    padding: '8px 10px',
                  }}
                >
                  <span
                    className={`b-pill ${CATEGORY_META[s.category].pill}`}
                    style={{ flex: 'none' }}
                  >
                    {CATEGORY_META[s.category].short}
                  </span>
                  <Tooltip title="点击回填到搜索框">
                    <button
                      type="button"
                      onClick={() => {
                        setCategory(s.category)
                        setKeyword(s.keyword)
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: 0,
                        fontFamily: 'var(--b-font)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12.5,
                        fontWeight: 800,
                        color: 'var(--b-ink)',
                      }}
                    >
                      {s.keyword}
                    </button>
                  </Tooltip>
                  <span style={{ flex: 'none', fontSize: 11, color: 'var(--b-ink-faint)' }}>
                    {dayjs(s.createdAt).format('YYYY-MM-DD')}
                  </span>
                  <Tooltip title="取消订阅">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeSub(s.id)}
                    />
                  </Tooltip>
                </div>
              ))}
            </Space>
          )}
        </div>
      </Card>
    </div>
  )
}
