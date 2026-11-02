import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { buildPalette, parseChoice, type AccentChoice, type AccentPalette } from '../accent'

const STORAGE_KEY = 'timetable.accent'
const STYLE_ID = 'kexu-accent-style'

interface AccentCtx {
  choice: AccentChoice | null
  palette: AccentPalette | null
  setChoice: (choice: AccentChoice | null) => void
}

const Ctx = createContext<AccentCtx>({
  choice: null,
  palette: null,
  setChoice: () => {},
})

export const useAccent = () => useContext(Ctx)

/**
 * 主题色偏好。只覆盖强调色相关的 CSS 变量，其余配色仍由 index.css 的主题定义。
 * 选择 `null` 时移除覆盖，回到内置配色。
 */
export function AccentProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<AccentChoice | null>(() => parseChoice(localStorage.getItem(STORAGE_KEY)))
  const palette = useMemo(() => (choice ? buildPalette(choice) : null), [choice])

  useEffect(() => {
    const existing = document.getElementById(STYLE_ID)
    if (!palette) {
      existing?.remove()
      return
    }
    const css = [
      `:root[data-theme='light']{--accent:${palette.light.base};--accent-hover:${palette.light.hover};--accent-soft:${palette.light.soft};--focus-ring:${palette.light.base};}`,
      `:root[data-theme='dark']{--accent:${palette.dark.base};--accent-hover:${palette.dark.hover};--accent-soft:${palette.dark.soft};--focus-ring:${palette.dark.base};}`,
    ].join('')
    const style = (existing as HTMLStyleElement | null) ?? document.createElement('style')
    style.id = STYLE_ID
    style.textContent = css
    if (!existing) document.head.appendChild(style)
  }, [palette])

  const setChoice = (next: AccentChoice | null) => {
    setChoiceState(next)
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  }

  return <Ctx.Provider value={{ choice, palette, setChoice }}>{children}</Ctx.Provider>
}
