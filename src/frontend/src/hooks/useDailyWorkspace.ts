import { useCallback, useMemo } from 'react'
import { projectDailyWorkspace } from '../local/daily/selectors'
import { useLocalState } from '../store/LocalStateContext'

export function useDailyWorkspace(date: string) {
  const { state, refresh: refreshState } = useLocalState()
  const workspace = useMemo(() => projectDailyWorkspace(state, date), [state, date])
  const refresh = useCallback(async () => {
    return projectDailyWorkspace(await refreshState(), date)
  }, [date, refreshState])

  return { workspace, refresh }
}
