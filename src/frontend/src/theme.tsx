import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { theme as antdTheme, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useFont } from './store/FontContext'

type Mode = 'light' | 'dark'

interface ThemeCtx {
  mode: Mode
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', toggle: () => {} })
export const useTheme = () => useContext(Ctx)

const STORAGE_KEY = 'timetable-theme'

function getInitialMode(): Mode {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const TOKENS = {
  light: {
    colorPrimary: '#58CC02',
    colorBgBase: '#F7F7F7',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBgLayout: '#F7F7F7',
    colorText: '#3C3C3C',
    colorTextSecondary: '#777777',
    colorBorder: '#E9E9E9',
    colorBorderSecondary: '#EFEFEF',
    colorSplit: '#E9E9E9',
    borderRadius: 14,
    fontFamily:
      "'Nunito', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 14,
    controlHeight: 36,
  },
  dark: {
    colorPrimary: '#4CAF0A',
    colorBgBase: '#1a1a1a',
    colorBgContainer: '#242424',
    colorBgElevated: '#363636',
    colorBgLayout: '#1a1a1a',
    colorText: '#f0ebe4',
    colorTextSecondary: '#999999',
    colorBorder: '#3a3a3a',
    colorBorderSecondary: '#3a3a3a',
    colorSplit: '#3a3a3a',
    borderRadius: 14,
    fontFamily:
      "'Nunito', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 14,
    controlHeight: 36,
  },
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(getInitialMode)
  const { globalScale } = useFont()

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))

  return (
    <Ctx.Provider value={{ mode, toggle }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { ...TOKENS[mode], fontSize: Math.round(14 * globalScale) },
          components: {
            Layout: {
              headerBg: '#FFFFFF',
              siderBg: mode === 'dark' ? '#242424' : '#FFFFFF',
              bodyBg: mode === 'dark' ? '#1a1a1a' : '#F7F7F7',
              footerBg: mode === 'dark' ? '#111111' : '#FFFFFF',
            },
            Menu: {
              itemBg: 'transparent',
              itemColor: mode === 'dark' ? '#f0ebe4' : '#3C3C3C',
              itemSelectedBg: mode === 'dark' ? '#22331A' : '#EAFCD9',
              itemSelectedColor: mode === 'dark' ? '#9BE36B' : '#3E8A02',
              itemBorderRadius: 12,
              itemHeight: 38,
              itemMarginInline: 0,
              activeBarHeight: 0,
              activeBarBorderWidth: 0,
              subMenuItemBg: 'transparent',
            },
            Card: {
              headerBg: mode === 'dark' ? '#363636' : '#FFFFFF',
              headerFontSize: Math.round(15 * globalScale),
              borderRadiusLG: 18,
            },
            Modal: {
              headerBg: mode === 'dark' ? '#242424' : '#ffffff',
              contentBg: mode === 'dark' ? '#242424' : '#ffffff',
              borderRadiusLG: 20,
            },
            Table: {
              headerBg: mode === 'dark' ? '#363636' : '#F7F7F7',
              headerColor: mode === 'dark' ? '#f0ebe4' : '#3C3C3C',
              rowHoverBg: mode === 'dark' ? '#2d2d2d' : '#F7F7F7',
              borderColor: mode === 'dark' ? '#3a3a3a' : '#E9E9E9',
            },
            Tag: {
              defaultBg: mode === 'dark' ? '#363636' : '#F7F7F7',
              defaultColor: mode === 'dark' ? '#f0ebe4' : '#3C3C3C',
              borderRadius: 99,
            },
            Button: {
              borderRadius: 14,
              controlHeight: 36,
              fontWeight: 800,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </Ctx.Provider>
  )
}
