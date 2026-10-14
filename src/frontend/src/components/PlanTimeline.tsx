import { Space, Tag, Timeline, Typography } from 'antd'
import type { DailyPlan, DailyPlanItem, DailyPlanItemType } from '../types'

/** 块类型 → 颜色与中文名（与后端块类型白名单一致） */
const ITEM_STYLES: Record<DailyPlanItemType, { color: string; label: string }> = {
  COURSE: { color: 'geekblue', label: '课程' },
  TASK: { color: 'cyan', label: '任务' },
  BREAK: { color: 'green', label: '休息' },
  SUGGESTION: { color: 'gold', label: '建议' },
}

/**
 * 每日计划时间线（AI Campus Agent V1.0 Step 6）。
 *
 * 课程块/任务块/休息块/建议块用不同颜色区分；块上的 id 都是真实数据引用，
 * 与首页其它区块同源——不展示任何模型凭空生成的事项。
 */
export default function PlanTimeline({ plan }: { plan: DailyPlan }) {
  return (
    <Timeline
      items={plan.items.map((item) => ({
        color: ITEM_STYLES[item.type]?.color ?? 'blue',
        children: <ItemBlock item={item} />,
      }))}
    />
  )
}

function ItemBlock({ item }: { item: DailyPlanItem }) {
  const style = ITEM_STYLES[item.type] ?? { color: 'blue', label: item.type }
  return (
    <div>
      <Space size={6} wrap>
        <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {item.start}-{item.end}
        </Typography.Text>
        <Tag color={style.color} style={{ marginInlineEnd: 0 }}>
          {style.label}
        </Tag>
        <Typography.Text>{item.title}</Typography.Text>
      </Space>
      {item.note && (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
          {item.note}
        </div>
      )}
    </div>
  )
}
