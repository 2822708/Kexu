import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { dayjs } from '../utils/schedule'

/**
 * 奖励机制（明亮风格 UI 的游戏化层，轻量实现）。
 *
 * 设计原则：
 * - 只做「加分」不做「扣分」——没有 Hearts/生命值惩罚，避免焦虑感
 * - 每日上限 DAILY_CAP，防刷分；连续天数（streak）按「当天有收获」自然延续
 * - 当前为纯前端 localStorage 实现；数据结构与 API 就绪，后续可无缝迁移到服务端
 */

export type RewardReason = 'todo' | 'task' | 'ai_chat' | 'checkin' | 'bonus'

/** 各行为积分表 */
const XP_TABLE: Record<RewardReason, number> = {
  todo: 15,
  task: 20,
  ai_chat: 5,
  checkin: 10,
  bonus: 30,
}

const REASON_LABEL: Record<RewardReason, string> = {
  todo: '完成待办',
  task: '完成任务',
  ai_chat: '与 AI 对话',
  checkin: '每日打卡',
  bonus: '额外奖励',
}

/** 每日积分上限（防刷） */
const DAILY_CAP = 100

/** 等级表（按累计 XP 升档） */
const LEVELS: { xp: number; title: string }[] = [
  { xp: 0, title: '新生' },
  { xp: 100, title: '探索者' },
  { xp: 300, title: '奋进者' },
  { xp: 700, title: '学霸' },
  { xp: 1500, title: '卷王' },
  { xp: 3000, title: '传奇' },
]

/** 成就表 */
const ACHIEVEMENTS: { id: string; label: string; desc: string }[] = [
  { id: 'first_blood', label: '第一步', desc: '首次获得积分' },
  { id: 'streak_3', label: '渐入佳境', desc: '连续 3 天有收获' },
  { id: 'streak_7', label: '一周坚持', desc: '连续 7 天有收获' },
  { id: 'day_5', label: '高效一天', desc: '单日获得 75+ 积分' },
  { id: 'night_owl', label: '夜猫子', desc: '22 点后还在努力' },
  { id: 'early_bird', label: '早起的鸟', desc: '7 点前就开始学习' },
  { id: 'xp_500', label: '小有所成', desc: '累计积分达到 500' },
]

interface RewardsState {
  xp: number
  streak: number
  /** 最后一次获得积分的日期 YYYY-MM-DD */
  lastActiveDate: string
  /** 今日已获得积分（跨天自动重置） */
  todayEarned: number
  achievements: string[]
}

interface EarnResult {
  amount: number
  reason: RewardReason
  levelUp: boolean
  newAchievements: string[]
}

/** 浮字事件（带自增 id，供 UI 监听变化） */
export interface RewardEvent {
  id: number
  amount: number
  label: string
  levelUp: boolean
  newAchievements: string[]
}

interface RewardsCtx {
  state: RewardsState
  /** 当前等级（1 起） */
  level: number
  levelTitle: string
  /** 距下一级还需多少 XP；已满级为 null */
  nextLevelXp: number | null
  lastEvent: RewardEvent | null
  earn: (reason: RewardReason) => EarnResult | null
  dismissEvent: () => void
  achievementList: typeof ACHIEVEMENTS
}

const STORAGE_KEY = 'timetable.rewards.v1'

const DEFAULT_STATE: RewardsState = {
  xp: 0,
  streak: 0,
  lastActiveDate: '',
  todayEarned: 0,
  achievements: [],
}

function loadState(): RewardsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw) as Partial<RewardsState>
    const today = dayjs().format('YYYY-MM-DD')
    return {
      xp: Number(parsed.xp) || 0,
      streak: Number(parsed.streak) || 0,
      lastActiveDate: parsed.lastActiveDate ?? '',
      // 跨天重置今日计数（streak 的延续判定在 earn 时做）
      todayEarned: parsed.lastActiveDate === today ? Number(parsed.todayEarned) || 0 : 0,
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function levelOf(xp: number): { index: number; title: string; nextXp: number | null } {
  let index = 0
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].xp) index = i
  }
  return {
    index,
    title: LEVELS[index].title,
    nextXp: index + 1 < LEVELS.length ? LEVELS[index + 1].xp : null,
  }
}

const Ctx = createContext<RewardsCtx | null>(null)

export function RewardsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RewardsState>(loadState)
  const [lastEvent, setLastEvent] = useState<RewardEvent | null>(null)
  const eventIdRef = useRef(0)

  /** 同步最新 state 到 ref：earn 里做纯计算，避免 updater 副作用（StrictMode 安全） */
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const levelInfo = useMemo(() => levelOf(state.xp), [state.xp])

  const earn = useCallback((reason: RewardReason): EarnResult | null => {
    const prev = stateRef.current
    const today = dayjs().format('YYYY-MM-DD')

    // 跨天时今日计数归零（streak 连续性仍按 lastActiveDate 判定）
    const todayEarned = prev.lastActiveDate === today ? prev.todayEarned : 0
    if (todayEarned >= DAILY_CAP) return null

    const base = XP_TABLE[reason]
    const amount = Math.min(base, DAILY_CAP - todayEarned)

    // streak：今天首次获得积分时，昨天也有记录则延续，否则重新计数
    const isFirstToday = prev.lastActiveDate !== today
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const streak = isFirstToday
      ? prev.lastActiveDate === yesterday
        ? prev.streak + 1
        : 1
      : prev.streak

    const xp = prev.xp + amount
    const levelUp = levelOf(xp).index > levelOf(prev.xp).index

    // 成就检查（幂等：已解锁不重复）
    const unlocked = new Set(prev.achievements)
    const hour = dayjs().hour()
    if (xp >= 1) unlocked.add('first_blood')
    if (streak >= 3) unlocked.add('streak_3')
    if (streak >= 7) unlocked.add('streak_7')
    if (todayEarned + amount >= 75) unlocked.add('day_5')
    if (hour >= 22 || hour < 5) unlocked.add('night_owl')
    if (hour < 7) unlocked.add('early_bird')
    if (xp >= 500) unlocked.add('xp_500')

    const achievements = [...unlocked]
    const newAchievements = achievements.filter((a) => !prev.achievements.includes(a))

    setState({
      xp,
      streak,
      lastActiveDate: today,
      todayEarned: todayEarned + amount,
      achievements,
    })

    eventIdRef.current += 1
    setLastEvent({
      id: eventIdRef.current,
      amount,
      label: REASON_LABEL[reason],
      levelUp,
      newAchievements,
    })

    return { amount, reason, levelUp, newAchievements }
  }, [])

  const dismissEvent = useCallback(() => setLastEvent(null), [])

  const value = useMemo<RewardsCtx>(
    () => ({
      state,
      level: levelInfo.index + 1,
      levelTitle: levelInfo.title,
      nextLevelXp: levelInfo.nextXp,
      lastEvent,
      earn,
      dismissEvent,
      achievementList: ACHIEVEMENTS,
    }),
    [state, levelInfo, lastEvent, earn, dismissEvent],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRewards(): RewardsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRewards 必须在 RewardsProvider 内使用')
  return ctx
}
