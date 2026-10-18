import { useEffect, useState } from 'react'
import { useRewards } from '../store/RewardsContext'

/**
 * 顶栏奖励徽章：连续天数 + 积分/等级。
 * xp 变化时弹跳一下（bump），给「又进一步」的即时反馈。
 */
export default function RewardsBadge() {
  const { state, level, levelTitle, nextLevelXp } = useRewards()
  const [xpBump, setXpBump] = useState(false)
  const [streakBump, setStreakBump] = useState(false)

  useEffect(() => {
    setXpBump(true)
    const t = setTimeout(() => setXpBump(false), 400)
    return () => clearTimeout(t)
  }, [state.xp])

  useEffect(() => {
    setStreakBump(true)
    const t = setTimeout(() => setStreakBump(false), 400)
    return () => clearTimeout(t)
  }, [state.streak])

  const xpTitle =
    nextLevelXp == null
      ? `累计积分 ${state.xp} · 已达最高等级`
      : `累计积分 ${state.xp} · 距 Lv${level + 1} 还差 ${nextLevelXp - state.xp} XP`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        className={`b-badge streak${streakBump ? ' bump' : ''}`}
        title={`连续学习 ${state.streak} 天 · 每天有收获即延续`}
      >
        <span className="ico">🔥</span>
        <span className="v">{state.streak}</span>
      </div>
      <div className={`b-badge xp${xpBump ? ' bump' : ''}`} title={xpTitle}>
        <span className="ico">⭐</span>
        <span className="v">{state.xp}</span>
        <span className="lv">
          Lv{level} {levelTitle}
        </span>
      </div>
    </div>
  )
}
