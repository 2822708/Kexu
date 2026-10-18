/**
 * 「安装到设备」提示卡（PWA 渐进增强，非硬依赖）。
 *
 * 触发链路：
 *   - Android / 桌面 Chrome：beforeinstallprompt 事件可被拦截，
 *     点按钮弹原生安装对话框——这是唯一能在用户手势里调起安装的方式
 *   - iOS Safari：不支持该事件，改为文字指引（分享 → 添加到主屏幕）
 *   - 已安装（standalone 模式）或 7 天内点过「以后再说」：不再出现
 *
 * 刻意不做自动弹窗：安装是用户的选择权，不是该被推销的东西。
 */
import { useCallback, useEffect, useState } from 'react'
import { DownloadOutlined, CloseOutlined, ShareAltOutlined } from '@ant-design/icons'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'timetable.pwaInstallDismissed'
const DISMISS_DAYS = 7

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_DAYS * 86400_000
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  // iOS 旧 API 与标准 API 都查：后者覆盖面广，前者覆盖老系统
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone() || isDismissed()) return

    const onPrompt = (event: Event) => {
      event.preventDefault() // 不让 Chrome 弹自己的迷你提示栏，统一走我们的卡
      setInstallEvent(event as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setVisible(false)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    }
    setInstallEvent(null)
  }, [installEvent])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // 写不进去也只是下次再问
    }
  }, [])

  // iOS：没有 beforeinstallprompt，但值得告诉用户怎么装
  const [iosVisible, setIosVisible] = useState(false)
  useEffect(() => {
    if (isStandalone() || isDismissed() || !isIos()) return
    if (installEvent) return // 真事件优先（未来 iOS 若支持）
    setIosVisible(true)
  }, [installEvent])

  const showCard = visible || iosVisible
  if (!showCard) return null

  return (
    <div className="pwa-install">
      <style>{`
        .pwa-install {
          position: fixed;
          left: 50%;
          bottom: 28px;
          transform: translateX(-50%);
          z-index: 1000;
          width: min(420px, calc(100vw - 32px));
          background: #fff;
          border-radius: 24px;
          box-shadow: var(--b-sh3);
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .pwa-install-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--b-green-soft);
          color: var(--b-green-ink);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          flex-shrink: 0;
        }
        .pwa-install-body { flex: 1; min-width: 0; }
        .pwa-install-title {
          font-weight: 800;
          font-size: 15px;
          color: var(--b-ink, #1b1b1f);
          margin-bottom: 2px;
        }
        .pwa-install-desc {
          font-size: 12.5px;
          color: #6b7280;
          line-height: 1.5;
        }
        .pwa-install-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .pwa-install-btn {
          border: none;
          cursor: pointer;
          font-weight: 800;
          font-size: 13.5px;
          color: #fff;
          background: var(--b-green);
          border-radius: 16px;
          padding: 9px 16px;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: transform 150ms ease, filter 150ms ease;
        }
        .pwa-install-btn:hover { filter: brightness(1.06); transform: translateY(-1px); }
        .pwa-install-btn:active { transform: translateY(1px); background: var(--b-green-press); }
        .pwa-install-later {
          border: none;
          background: transparent;
          cursor: pointer;
          color: #9ca3af;
          font-size: 12.5px;
          font-weight: 700;
          padding: 6px;
        }
        .pwa-install-later:hover { color: #6b7280; }
      `}</style>

      <div className="pwa-install-icon">
        {iosVisible ? <ShareAltOutlined /> : <DownloadOutlined />}
      </div>
      <div className="pwa-install-body">
        <div className="pwa-install-title">装到你的设备上</div>
        <div className="pwa-install-desc">
          {iosVisible
            ? '点 Safari 底部的分享按钮，选「添加到主屏幕」，就像原生 App 一样打开。'
            : '安装后可从桌面/主屏幕直接打开，离线也能看已缓存的内容。'}
        </div>
      </div>
      <div className="pwa-install-actions">
        {iosVisible ? null : (
          <>
            <button type="button" className="pwa-install-later" onClick={handleDismiss}>
              以后再说
            </button>
            <button type="button" className="pwa-install-btn" onClick={handleInstall}>
              <DownloadOutlined />
              安装
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="关闭安装提示"
        className="pwa-install-later"
        style={{ position: 'absolute', top: 6, right: 8, fontSize: 11 }}
        onClick={handleDismiss}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}
