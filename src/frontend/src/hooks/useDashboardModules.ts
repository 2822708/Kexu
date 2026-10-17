import { useCallback, useMemo, useState } from 'react'
import type { TimeOfDay } from '../types'

/**
 * 首页模块的排序与显隐（方案「基础交互补充」第 1 条），配置存在 localStorage。
 *
 * 设计上刻意分成两层，别混为一谈：
 *
 * 1. **时段决定「这个模块在当前时段有没有意义」**（`periods`）——这是产品行为，
 *    不给用户改。午间把「今日必做」收缩成小条、晚间改看明日预览，是分时动态 UI
 *    的核心，让用户强行打开只会把页面撑成长条，反而丢了这个特性。
 * 2. **用户决定「在可用的模块里关掉哪些、按什么顺序排」**（`hidden` / `order`）——
 *    这才是自定义该管的事。
 *
 * 所以设置弹窗里，当前时段不可用的模块开关是禁用的，并标注它在哪些时段出现，
 * 不让用户对着一个「勾了也不生效」的开关困惑。
 */
export type DashboardModuleKey =
  | 'tasks'
  | 'courses'
  | 'exams'
  | 'upcoming'
  | 'notices'
  | 'tomorrow'
  | 'highlights'
  | 'plan'

export interface DashboardModuleMeta {
  key: DashboardModuleKey
  label: string
  /** 不填 = 所有时段都可能出现 */
  periods?: TimeOfDay[]
  /** 为什么被时段限制，展示给用户看 */
  note?: string
}

export const DASHBOARD_MODULES: DashboardModuleMeta[] = [
  { key: 'tasks', label: '今日必做', periods: ['morning', 'night'], note: '午间会收缩成顶部小条' },
  { key: 'courses', label: '今日课程', periods: ['morning', 'day'], note: '晚间改看明日课表' },
  { key: 'exams', label: '考试倒计时', periods: ['morning', 'day'] },
  { key: 'upcoming', label: '48 小时内截止', periods: ['morning'] },
  { key: 'notices', label: '今日待阅' },
  { key: 'tomorrow', label: '明日课表预览', periods: ['night'] },
  { key: 'highlights', label: '今日重点', periods: ['morning', 'night'] },
  { key: 'plan', label: 'AI 学长建议' },
]

const META = new Map(DASHBOARD_MODULES.map((m) => [m.key, m]))
const DEFAULT_ORDER: DashboardModuleKey[] = DASHBOARD_MODULES.map((m) => m.key)
const STORAGE_KEY = 'timetable.dashboard.modules'

interface ModuleConfig {
  order: DashboardModuleKey[]
  hidden: DashboardModuleKey[]
}

/** 当前时段下这个模块是否可能出现 */
export function isModuleAvailable(key: DashboardModuleKey, period: TimeOfDay): boolean {
  const periods = META.get(key)?.periods
  return periods == null || periods.includes(period)
}

/**
 * 读存档时做一次清洗：丢掉不认识的 key，补齐后加的模块。
 *
 * 后半句是关键——以后新增模块时，老用户的存档里没有它，
 * 不补就会「我这辈子都看不到这个新功能」，而且用户根本不知道去哪开。
 */
function readConfig(): ModuleConfig {
  const fallback: ModuleConfig = { order: [...DEFAULT_ORDER], hidden: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<'order' | 'hidden', string[]>>
    const savedOrder = Array.isArray(parsed.order) ? parsed.order : []
    const known = (k: string): k is DashboardModuleKey => META.has(k as DashboardModuleKey)
    return {
      order: [
        ...savedOrder.filter(known),
        ...DEFAULT_ORDER.filter((k) => !savedOrder.includes(k)),
      ],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter(known) : [],
    }
  } catch {
    // 存档坏了（手改过、旧版本格式）就回默认，不要因为一个坏 JSON 让首页白屏
    return fallback
  }
}

export function useDashboardModules(period: TimeOfDay) {
  const [config, setConfig] = useState<ModuleConfig>(readConfig)

  const apply = useCallback((next: ModuleConfig) => {
    setConfig(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 写不进去只是这次自定义不保存，不影响使用
    }
  }, [])

  const move = useCallback(
    (key: DashboardModuleKey, delta: number) => {
      const from = config.order.indexOf(key)
      const to = from + delta
      if (from < 0 || to < 0 || to >= config.order.length) return
      const order = [...config.order]
      order.splice(from, 1)
      order.splice(to, 0, key)
      apply({ ...config, order })
    },
    [apply, config],
  )

  const toggle = useCallback(
    (key: DashboardModuleKey, hidden: boolean) => {
      apply({
        ...config,
        hidden: hidden
          ? [...new Set([...config.hidden, key])]
          : config.hidden.filter((k) => k !== key),
      })
    },
    [apply, config],
  )

  const reset = useCallback(() => apply({ order: [...DEFAULT_ORDER], hidden: [] }), [apply])

  /** 当前时段真正要渲染的模块（已按时段过滤 + 用户显隐过滤 + 用户排序） */
  const visible = useMemo(
    () => config.order.filter((k) => !config.hidden.includes(k) && isModuleAvailable(k, period)),
    [config, period],
  )

  return { visible, order: config.order, hidden: config.hidden, move, toggle, reset }
}
