import { useEffect, useState } from 'react'
import { useRewards } from '../store/RewardsContext'

/**
 * 全局奖励浮字：获得积分时在顶部中央弹出「+15 XP · 完成待办」。
 * 监听 lastEvent.id 变化，2.2s 后自动消失。
 */
export default function RewardFloat() {
  const { lastEvent, dismissEvent } = useRewards()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!lastEvent) return
    setShow(true)
    const t = setTimeout(() => {
      setShow(false)
      dismissEvent()
    }, 2200)
    return () => clearTimeout(t)
  }, [lastEvent, dismissEvent])

  if (!lastEvent) return null

  return (
    <div className={`b-reward-float${show ? ' show' : ''}`} data-testid="reward-float">
      <span className="amt">+{lastEvent.amount} XP</span>
      <span className="lbl">
        {lastEvent.label}
        {lastEvent.levelUp ? ' · 升级啦！' : ''}
      </span>
    </div>
  )
}
