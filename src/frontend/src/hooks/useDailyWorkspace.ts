import { useCallback, useEffect, useRef, useState } from 'react'
import { dailyApi } from '../local/daily/commands'
import { subscribeLocalChanges } from '../local/db'

type Workspace = Awaited<ReturnType<typeof dailyApi.readWorkspace>>

export function useDailyWorkspace(date: string) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const currentDate = useRef(date)
  currentDate.current = date
  const mounted = useRef(true)
  const invalidate = useCallback(() => {
    mounted.current = false
    sequence.current += 1
  }, [])
  const refresh = useCallback(async () => {
    const request = date === currentDate.current ? ++sequence.current : null
    try {
      const value = await dailyApi.readWorkspace(date)
      if (
        mounted.current &&
        currentDate.current === date &&
        request !== null &&
        request === sequence.current
      ) {
        setWorkspace(value)
        setError('')
      }
      return value
    } catch (err) {
      if (
        mounted.current &&
        currentDate.current === date &&
        request !== null &&
        request === sequence.current
      )
        setError(err instanceof Error ? err.message : '日任务读取失败')
      throw err
    }
  }, [date])
  useEffect(() => {
    mounted.current = true
    const load = () => {
      void refresh().catch(() => {
        /* The matching request handles its own error. */
      })
    }
    const stop = subscribeLocalChanges(load)
    const visible = () => {
      if (document.visibilityState === 'visible') load()
    }
    load()
    document.addEventListener('visibilitychange', visible)
    return () => {
      invalidate()
      stop()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh, invalidate])
  return { workspace: workspace?.date === date ? workspace : null, error, refresh }
}
