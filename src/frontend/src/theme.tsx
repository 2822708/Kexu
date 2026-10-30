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
  return 'light'
}

const SYSTEM_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'

const TOKENS = {
  light: {
    colorPrimary: '#167d9a',
    colorInfo: '#167d9a',
    colorSuccess: '#0c7c72',
    colorWarning: '#ad6800',
    colorError: '#b42318',
    colorBgBase: '#f5f8fa',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f8fa',
    colorText: '#173244',
    colorTextSecondary: '#536b78',
    colorTextTertiary: '#647b87',
    colorTextPlaceholder: '#536b78',
    colorTextLightSolid: '#ffffff',
    colorBorder: '#c7d6df',
    colorBorderSecondary: '#dde6eb',
    colorSplit: '#dde6eb',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily: SYSTEM_FONT,
    fontSize: 14,
    controlHeight: 38,
    boxShadowSecondary: '0 8px 28px rgba(23, 50, 68, 0.12)',
  },
  dark: {
    colorPrimary: '#69c6d5',
    colorInfo: '#69c6d5',
    colorSuccess: '#65c5ad',
    colorWarning: '#e7b86a',
    colorError: '#ff958c',
    colorBgBase: '#101d27',
    colorBgContainer: '#172a35',
    colorBgElevated: '#203743',
    colorBgLayout: '#101d27',
    colorText: '#e5f0f5',
    colorTextSecondary: '#abc1cc',
    colorTextTertiary: '#97afbb',
    colorTextPlaceholder: '#97afbb',
    colorTextLightSolid: '#0d232c',
    colorBorder: '#46616e',
    colorBorderSecondary: '#314a57',
    colorSplit: '#314a57',
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
              headerBg: TOKENS[mode].colorBgContainer,
              siderBg: TOKENS[mode].colorBgContainer,
              bodyBg: TOKENS[mode].colorBgLayout,
              footerBg: TOKENS[mode].colorBgLayout,
            },
            Menu: {
              itemBg: 'transparent',
              itemColor: TOKENS[mode].colorTextSecondary,
              itemSelectedBg: mode === 'dark' ? '#203f4c' : '#e7f4f7',
              itemSelectedColor: TOKENS[mode].colorPrimary,
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
              headerBg: mode === 'dark' ? '#203743' : '#f3f8fa',
              headerColor: TOKENS[mode].colorText,
              rowHoverBg: mode === 'dark' ? '#203743' : '#f3f8fa',
              borderColor: TOKENS[mode].colorBorderSecondary,
            },
            Tag: {
              defaultBg: mode === 'dark' ? '#203743' : '#f3f8fa',
              defaultColor: TOKENS[mode].colorTextSecondary,
              fontSizeSM: Math.round(12 * globalScale),
            },
            Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 600 },
            Segmented: {
              trackBg: mode === 'dark' ? '#101d27' : '#edf3f6',
              itemSelectedBg: TOKENS[mode].colorBgContainer,
              itemSelectedColor: TOKENS[mode].colorPrimary,
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
