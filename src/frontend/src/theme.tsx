import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { theme as antdTheme, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useFont } from './store/FontContext'
import { useAccent } from './store/AccentContext'

type Mode = 'light' | 'dark'

interface ThemeCtx {
  mode: Mode
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'light', toggle: () => {} })
export const useTheme = () => useContext(Ctx)

const STORAGE_KEY = 'timetable-theme'

function getInitialMode(): Mode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Preferences may be unavailable in restricted browser contexts.
  }
  return 'light'
}

const SYSTEM_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

const TOKENS = {
  light: {
    colorPrimary: '#33624c',
    colorInfo: '#33624c',
    colorSuccess: '#356b52',
    colorWarning: '#ad6800',
    colorError: '#b42318',
    colorBgBase: '#f6f4ec',
    colorBgContainer: '#fffefa',
    colorBgElevated: '#fffefa',
    colorBgLayout: '#f6f4ec',
    colorText: '#26352c',
    colorTextSecondary: '#515e52',
    colorTextTertiary: '#5b685d',
    colorTextPlaceholder: '#515e52',
    colorTextLightSolid: '#ffffff',
    colorBorder: '#c3cbbd',
    colorBorderSecondary: '#d9ded3',
    colorSplit: '#d9ded3',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    controlHeight: 38,
    boxShadowSecondary: '0 8px 28px rgba(38, 53, 44, 0.12)',
  },
  dark: {
    colorPrimary: '#a5cfb3',
    colorInfo: '#a5cfb3',
    colorSuccess: '#9fcbb1',
    colorWarning: '#e7b86a',
    colorError: '#ff958c',
    colorBgBase: '#171f1a',
    colorBgContainer: '#202b24',
    colorBgElevated: '#28362d',
    colorBgLayout: '#171f1a',
    colorText: '#ebf2e8',
    colorTextSecondary: '#b8c7b9',
    colorTextTertiary: '#a8baaa',
    colorTextPlaceholder: '#a8baaa',
    colorTextLightSolid: '#15271d',
    colorBorder: '#4e6254',
    colorBorderSecondary: '#37473c',
    colorSplit: '#37473c',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    controlHeight: 38,
    boxShadowSecondary: '0 8px 28px rgba(0, 0, 0, 0.28)',
  },
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(getInitialMode)
  const { globalScale } = useFont()
  const { palette } = useAccent()
  const accent = palette ? palette[mode] : null
  const primary = accent?.base ?? TOKENS[mode].colorPrimary
  const selectedSoft = accent?.soft ?? (mode === 'dark' ? '#2a4134' : '#e7eee4')
  // 选中项文字落在 accent-soft 上，必须用对比度校正过的 ink，而不是 base。
  const selectedText = accent?.ink ?? (mode === 'dark' ? '#a5cfb3' : '#28523e')

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // The theme still applies for this session.
    }
  }, [mode])

  const toggle = () => setMode((m) => (m === 'light' ? 'dark' : 'light'))

  return (
    <Ctx.Provider value={{ mode, toggle }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { ...TOKENS[mode], colorPrimary: primary, colorInfo: primary, colorLink: selectedText, fontSize: Math.round(14 * globalScale) },
          components: {
            Layout: {
              headerBg: TOKENS[mode].colorBgContainer,
              siderBg: TOKENS[mode].colorBgContainer,
              bodyBg: TOKENS[mode].colorBgLayout,
              footerBg: TOKENS[mode].colorBgLayout,
            },
            Menu: {
              itemBg: 'transparent',
              itemColor: TOKENS[mode].colorTextSecondary,
              itemSelectedBg: selectedSoft,
              itemSelectedColor: selectedText,
              itemBorderRadius: 8,
              itemHeight: 44,
              itemMarginInline: 0,
              activeBarHeight: 0,
              activeBarBorderWidth: 0,
              subMenuItemBg: 'transparent',
            },
            Card: {
              headerBg: 'transparent',
              headerFontSize: Math.round(15 * globalScale),
              headerHeight: 52,
            },
            Modal: {
              headerBg: TOKENS[mode].colorBgContainer,
              contentBg: TOKENS[mode].colorBgContainer,
            },
            Table: {
              headerBg: mode === 'dark' ? '#28362d' : '#f3f8fa',
              headerColor: TOKENS[mode].colorText,
              rowHoverBg: mode === 'dark' ? '#28362d' : '#f3f8fa',
              borderColor: TOKENS[mode].colorBorderSecondary,
            },
            Tag: {
              defaultBg: mode === 'dark' ? '#28362d' : '#f3f8fa',
              defaultColor: TOKENS[mode].colorTextSecondary,
              fontSizeSM: Math.round(12 * globalScale),
            },
            Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 600 },
            Segmented: {
              trackBg: mode === 'dark' ? '#171f1a' : '#edf3f6',
              itemSelectedBg: TOKENS[mode].colorBgContainer,
              itemSelectedColor: primary,
              trackPadding: 4,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </Ctx.Provider>
  )
}
