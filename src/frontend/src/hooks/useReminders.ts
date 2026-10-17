import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '../types'
import { dayjs } from '../utils/schedule'

/**
 * 三级提醒的提前量（小时）。
 *
 * 写成可配置常量而不是散在代码里的魔法数字：这些阈值迟早要调，
 * 而且将来要接后端推送 / 桌面通知时，同一份配置能直接复用。
 */
export const REMINDER_LEADS = {
  /** 提前 3 天：预热，让用户知道有这么回事 */
  warm: 72,
  /** 提前 1 天：确认，该动手了 */
  confirm: 24,
  /** 提前 1 小时：临场，马上要做 */
  imminent: 1,
} as const

export type ReminderLevel = keyof typeof REMINDER_LEADS

export const REMINDER_LABELS: Record<ReminderLevel, string> = {
  warm: '3 天后截止',
  confirm: '明天截止',
  imminent: '1 小时后截止',
}

export const REMINDER_COLORS: Record<ReminderLevel, string> = {
  warm: 'blue',
  confirm: 'orange',
  imminent: 'red',
}

export interface Reminder {
  task: Task
  level: ReminderLevel
  /** 距截止还剩多少小时（已逾期为负） */
  hoursLeft: number
}

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS']

/** 命中哪一级提醒；都不命中返回 null。已逾期一律算 imminent（最紧急）。 */
function matchLevel(hoursLeft: number): ReminderLevel | null {
  if (hoursLeft <= REMINDER_LEADS.imminent) return 'imminent'
  if (hoursLeft <= REMINDER_LEADS.confirm) return 'confirm'
  if (hoursLeft <= REMINDER_LEADS.warm) return 'warm'
  return null
}

/**
 * 三级提醒（提前 3 天 / 1 天 / 1 小时）。
 *
 * <b>这是纯前端定时，页面关掉就不提醒了。</b>
 * 项目目前没有任何推送通道（唯一的 SSE 是 AI 聊天流式），后端定时 + 前端轮询
 * 要新增表、实体、端点、轮询逻辑，工作量翻倍，且最终仍需页面常开才能弹窗。
 * 所以先做前端，把规则和配置留成可复用的形状；要接后端推送时阈值不用重写。
 *
 * 系统通知走 Notification API，需要用户授权；未授权或浏览器不支持时静默降级，
 * 只保留页面内提醒条——不弹错误打扰用户。
 */
export function useReminders(tasks: Task[], enabled = true) {
  const [now, setNow] = useState(() => dayjs())
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  // 已弹过的任务不再重复弹，否则每分钟都会骚扰一次
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(dayjs()), 60_000)
    return () => window.clearInterval(timer)
  }, [enabled])

  // Notification 权限状态只查一次：用户改权限需要刷新页面，这是浏览器的限制
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    setNotifyEnabled(window.Notification.permission === 'granted')
  }, [])

  const reminders = useMemo<Reminder[]>(() => {
    if (!enabled) return []
    const list: Reminder[] = []
    for (const task of tasks) {
      if (!OPEN_STATUSES.includes(task.status)) continue
      if (task.deadline == null) continue
      const hoursLeft = dayjs(task.deadline).diff(now, 'hour', true)
      const level = matchLevel(hoursLeft)
      if (level == null) continue
      list.push({ task, level, hoursLeft })
    }
    return list.sort((a, b) => a.hoursLeft - b.hoursLeft)
  }, [tasks, now, enabled])

  const requestNotify = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try {
      const permission = await window.Notification.requestPermission()
      setNotifyEnabled(permission === 'granted')
    } catch {
      // 用户拒绝或非安全上下文时静默降级，保留页面内提醒条
      setNotifyEnabled(false)
    }
  }, [])

  // 到点了弹系统通知（每级只弹一次）
  useEffect(() => {
    if (!enabled || !notifyEnabled) return
    for (const reminder of reminders) {
      const key = `${reminder.task.id}:${reminder.level}`
      if (notifiedRef.current.has(key)) continue
      notifiedRef.current.add(key)
      try {
        new window.Notification(`${REMINDER_LABELS[reminder.level]}：${reminder.task.title}`, {
          body: `截止 ${dayjs(reminder.task.deadline).format('MM-DD HH:mm')}`,
        })
      } catch {
        // 弹窗失败不影响页面内提醒
      }
    }
  }, [reminders, notifyEnabled, enabled])

  return { reminders, requestNotify, notifyEnabled }
}
