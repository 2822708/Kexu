import { Space, Typography } from 'antd'
import type { DailyPlan, DailyPlanItem, DailyPlanItemType } from '../types'

/** 块类型 → 色板颜色、药丸变体与中文名（与后端块类型白名单一致） */
const ITEM_STYLES: Record<DailyPlanItemType, { color: string; pill: string; label: string }> = {
  COURSE: { color: 'var(--b-blue)', pill: 'blue', label: '课程' },
  TASK: { color: 'var(--b-purple)', pill: 'purple', label: '任务' },
  BREAK: { color: 'var(--b-green)', pill: 'green', label: '休息' },
  SUGGESTION: { color: 'var(--b-yellow)', pill: 'yellow', label: '建议' },
}

const FALLBACK_STYLE = { color: 'var(--b-blue)', pill: 'blue' }

/**
 * 每日计划时间线（AI Campus Agent V1.0 Step 6）。
 *
 * 课程块/任务块/休息块/建议块用不同颜色区分；块上的 id 都是真实数据引用，
 * 与首页其它区块同源——不展示任何模型凭空生成的事项。
 *
 * 明亮风：色板小圆点（下厚度 inset 光影）+ 浅色连接线 + 计划项卡片化。
 */
export default function PlanTimeline({ plan }: { plan: DailyPlan }) {
  const lastIndex = plan.items.length - 1
  return (
    <ol
      style={{
        display: 'flex',
        flexDirection: 'column',
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {plan.items.map((item, i) => {
        const style = ITEM_STYLES[item.type] ?? { ...FALLBACK_STYLE, label: item.type }
        return (
          <li
            key={i}
            style={{ display: 'flex', alignItems: 'stretch', gap: 12, paddingBottom: i === lastIndex ? 0 : 12 }}
          >
            {/* 时间轴轨道：色板小圆点 + 连接线 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: 14,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  marginTop: 13,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: style.color,
                  boxShadow: 'inset 0 -1px 0 rgba(0,0,0,.15)',
                }}
              />
              {i !== lastIndex && (
                <span
                  style={{
                    flex: 1,
                    width: 2,
                    marginBlock: 4,
                    borderRadius: 99,
                    background: 'var(--b-line)',
                  }}
                />
              )}
            </div>
            <ItemBlock item={item} />
          </li>
        )
      })}
    </ol>
  )
}

function ItemBlock({ item }: { item: DailyPlanItem }) {
  const style = ITEM_STYLES[item.type] ?? { ...FALLBACK_STYLE, label: item.type }
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--bg-card)',
        borderRadius: 'var(--b-radius-sm)',
        boxShadow: 'var(--b-sh1)',
        padding: '10px 14px',
      }}
    >
      <Space size={6} wrap>
        <Typography.Text
          strong
          style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: 'var(--b-ink)' }}
        >
          {item.start}-{item.end}
        </Typography.Text>
        <span className={`b-pill ${style.pill}`}>{style.label}</span>
        <Typography.Text style={{ color: 'var(--b-ink)' }}>{item.title}</Typography.Text>
      </Space>
      {item.note && (
        <div style={{ color: 'var(--b-ink-soft)', fontSize: 12, marginTop: 2 }}>
          {item.note}
        </div>
      )}
    </div>
  )
}
