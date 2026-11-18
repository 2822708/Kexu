import { createContext, useContext } from 'react'
import type { LocalState } from '../local/types'

export const LocalStateContext = createContext<{
  state: LocalState
  refresh: () => Promise<LocalState>
} | null>(null)

export function useLocalState() {
  const value = useContext(LocalStateContext)
  if (!value) throw new Error('本机数据尚未就绪')
  return value
}
