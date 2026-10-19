import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Typography } from 'antd'
import { DownloadOutlined, ReloadOutlined, WifiOutlined } from '@ant-design/icons'
import { findWaitingUpdate } from '../pwa/updateState'
import { useLocation } from 'react-router-dom'
import '../pwa/pwa.css'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const enabled = import.meta.env.MODE === 'mobile'
const inStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Mounted in the persistent app header so prompts survive route changes without covering content. */
export default function PwaStatus() {
  const onChatPage = useLocation().pathname.startsWith('/ai')
  const [online, setOnline] = useState(navigator.onLine)
  const [standalone, setStandalone] = useState(inStandalone)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [installError, setInstallError] = useState('')
  const [pwaError, setPwaError] = useState('')
  const [offlineStatus, setOfflineStatus] = useState<'preparing' | 'ready' | 'unavailable'>(
    'preparing',
  )
  const [updateError, setUpdateError] = useState('')
  const updateRequested = useRef(false)
  const activationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const offline = () => setOnline(false)
    const onlineAgain = () => setOnline(true)
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPrompt)
    }
    const installed = () => {
      setStandalone(true)
      setInstallPrompt(null)
      setGuideOpen(false)
    }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const modeChanged = () => setStandalone(inStandalone())
    window.addEventListener('offline', offline)
    window.addEventListener('online', onlineAgain)
    window.addEventListener('beforeinstallprompt', capturePrompt)
    window.addEventListener('appinstalled', installed)
    displayMode.addEventListener('change', modeChanged)
    return () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', onlineAgain)
      window.removeEventListener('beforeinstallprompt', capturePrompt)
      window.removeEventListener('appinstalled', installed)
      displayMode.removeEventListener('change', modeChanged)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) {
      setOfflineStatus('unavailable')
      return
    }
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    let installingWorker: ServiceWorker | null = null
    const statusChannels = new Set<MessageChannel>()
    let statusSequence = 0
    const checkOfflineStatus = (
      worker = registration?.active ?? navigator.serviceWorker.controller,
    ) => {
      if (!worker || !active) return
      const sequence = ++statusSequence
      if (typeof MessageChannel === 'undefined') {
        setOfflineStatus('unavailable')
        return
      }
      const channel = new MessageChannel()
      statusChannels.add(channel)
      const close = () => {
        clearTimeout(timeout)
        channel.port1.close()
        channel.port2.close()
        statusChannels.delete(channel)
      }
      const timeout = setTimeout(() => {
        close()
        if (active && sequence === statusSequence) setOfflineStatus('unavailable')
      }, 5000)
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        close()
        if (!active || sequence !== statusSequence) return
        const data = event.data as { type?: string; ready?: boolean; assetCount?: number }
        const ready =
          data?.type === 'OFFLINE_STATUS' &&
          data.ready === true &&
          typeof data.assetCount === 'number' &&
          data.assetCount > 0
        setOfflineStatus(ready ? 'ready' : 'unavailable')
      }
      try {
        worker.postMessage({ type: 'GET_OFFLINE_STATUS' }, [channel.port2])
      } catch {
        close()
        if (active && sequence === statusSequence) setOfflineStatus('unavailable')
      }
    }
    const observeWaiting = () => {
      // installed can fire just before the registration exposes waiting.
      // Capture the installed update only when a previous worker exists.
      const candidate = findWaitingUpdate(
        registration,
        installingWorker,
        !!navigator.serviceWorker.controller,
      )
      if (active && candidate) setWaiting(candidate)
    }
    const stateChanged = () => {
      if (installingWorker?.state === 'installed') {
        observeWaiting()
        checkOfflineStatus(registration?.active ?? installingWorker)
      }
      if (installingWorker?.state === 'redundant' && active) {
        setPwaError('新版本的离线资源未能完整下载，当前已保存的数据不受影响；请联网后重试。')
        checkOfflineStatus()
      }
    }
    const updateFound = () => {
      installingWorker?.removeEventListener('statechange', stateChanged)
      installingWorker = registration?.installing ?? null
      installingWorker?.addEventListener('statechange', stateChanged)
      observeWaiting()
    }
    const controllerChanged = () => {
      // Another tab's update or initial activation must never reload this page.
      if (updateRequested.current) {
        if (activationTimer.current) clearTimeout(activationTimer.current)
        window.location.reload()
      } else checkOfflineStatus()
    }
    const checkUpdate = () => {
      if (document.visibilityState === 'visible') {
        checkOfflineStatus()
        if (navigator.onLine) {
          void registration?.update().catch(() => {
            /* Keep the current version usable on a weak network. */
          })
        }
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    document.addEventListener('visibilitychange', checkUpdate)
    // Query an existing controller even when an offline registration refresh fails.
    checkOfflineStatus()
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .then((value) => {
        if (!active) return
        registration = value
        observeWaiting()
        registration.addEventListener('updatefound', updateFound)
        updateFound()
        checkUpdate()
        checkOfflineStatus()
      })
      .catch(() => {
        if (active) {
          if (navigator.serviceWorker.controller) {
            checkOfflineStatus()
            setPwaError('暂时无法检查应用更新，当前已准备的版本仍可使用；请联网后重试。')
          } else {
            setOfflineStatus('unavailable')
            setPwaError('离线页面资源尚未准备完成。本机数据仍保留；请联网后重新打开以完成准备。')
          }
        }
      })
    return () => {
      active = false
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
      document.removeEventListener('visibilitychange', checkUpdate)
      registration?.removeEventListener('updatefound', updateFound)
      installingWorker?.removeEventListener('statechange', stateChanged)
      for (const channel of statusChannels) {
        channel.port1.close()
        channel.port2.close()
      }
      if (activationTimer.current) clearTimeout(activationTimer.current)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) {
      setGuideOpen(true)
      return
    }
    setInstalling(true)
    setInstallError('')
    try {
      await installPrompt.prompt()
      const result = await installPrompt.userChoice
      if (result.outcome === 'accepted') setGuideOpen(false)
    } catch {
      setInstallError('浏览器未完成安装，请使用浏览器菜单中的安装入口。')
      setGuideOpen(true)
    } finally {
      setInstallPrompt(null)
      setInstalling(false)
    }
  }

  const update = async () => {
    if (!waiting || updating) return
    setUpdating(true)
    setUpdateError('')
    try {
      // This is an on-device restore point; updates never depend on cloud access.
      const { saveCurrentRestorePoint } = await import('../local/snapshots/restore')
      await saveCurrentRestorePoint()
      updateRequested.current = true
      // Another tab may have already activated this update. Only this explicit
      // saved-work confirmation is allowed to refresh the current tab.
      if (waiting.state === 'activated' || waiting.state === 'redundant') {
        window.location.reload()
        return
      }
      activationTimer.current = setTimeout(() => {
        updateRequested.current = false
        setUpdating(false)
        setUpdateError('更新尚未完成，已保留当前页面和本机恢复点。请稍后重试。')
      }, 15000)
      waiting.postMessage({ type: 'ACTIVATE_SAVED_UPDATE' })
    } catch (error) {
      updateRequested.current = false
      setUpdating(false)
      if (activationTimer.current) clearTimeout(activationTimer.current)
      setUpdateError(
        error instanceof Error
          ? `更新前的本机恢复点未能准备好：${error.message}`
          : '本机恢复点未能保存，已保留当前版本。',
      )
    }
  }

  if (!enabled) return null
  return (
    <>
      {!online && (
        <div className="pwa-offline" role="status">
          <WifiOutlined /> 当前离线，本机已保存的课表和待办仍可读写。云快照与 AI 需联网。
          {offlineStatus !== 'ready' && ' 页面资源尚未确认完整，联网后请完成离线准备。'}
        </div>
      )}
      <aside
        className={`pwa-controls${onChatPage ? ' pwa-controls-chat' : ''}`}
        aria-label="应用安装与更新"
      >
        {waiting && (
          <Button size="small" aria-label="更新应用" title="更新课序" icon={<ReloadOutlined />} onClick={() => setUpdateOpen(true)}>
            更新
          </Button>
        )}
        {!standalone && (
          <Button
            size="small"
            aria-label="安装应用"
            title="安装课序到主屏幕"
            icon={<DownloadOutlined />}
            loading={installing}
            onClick={() => void install()}
          >
            安装
          </Button>
        )}
        {standalone && offlineStatus !== 'ready' && (
          <Button size="small" onClick={() => setGuideOpen(true)}>
            离线准备
          </Button>
        )}
      </aside>
      <Modal
        title="将课序添加到主屏幕"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={<Button onClick={() => setGuideOpen(false)}>知道了</Button>}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>
            安装后可从手机主屏幕打开。课表、课程、考试和待办在本机保存，支持离线读写；云端只保存备份快照并提供应用下载。AI
            与云备份需要联网。
          </Typography.Paragraph>
          <Alert
            type={offlineStatus === 'ready' ? 'success' : 'info'}
            showIcon
            message={
              offlineStatus === 'ready'
                ? '离线资源已完整准备，核心页面可离线打开。'
                : offlineStatus === 'preparing'
                  ? '正在准备全部离线页面资源，请保持联网。'
                  : '离线资源尚未确认完整。当前本机数据仍保留，请联网后重新打开完成准备。'
            }
          />
          {!window.isSecureContext && (
            <Alert
              type="info"
              showIcon
              message="此地址无法准备离线安装。请使用受浏览器信任的 HTTPS 地址，或在本机使用 localhost。"
            />
          )}
          {!('serviceWorker' in navigator) && (
            <Alert type="info" message="当前浏览器不支持应用安装准备，可继续在浏览器中使用。" />
          )}
          {pwaError && <Alert type="info" message={pwaError} />}
          {installError && <Alert type="info" message={installError} />}
          <Typography.Paragraph>
            安卓：打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。若浏览器提供安装按钮，也可直接使用。
          </Typography.Paragraph>
          <Typography.Paragraph>
            iPhone / iPad：用 Safari
            打开此页面，点击“分享”，再选择“添加到主屏幕”。不同浏览器的菜单可能略有区别。
          </Typography.Paragraph>
          <Typography.Text type="secondary">
            请保持使用同一个地址和浏览器。本机数据保存在浏览器中；清除网站数据会删除本机课表，请另存导出文件与云恢复凭证。
          </Typography.Text>
        </Space>
      </Modal>
      <Modal
        title="更新应用"
        open={updateOpen}
        onCancel={() => {
          if (!updating) setUpdateOpen(false)
        }}
        closable={!updating}
        maskClosable={!updating}
        cancelButtonProps={{ disabled: updating }}
        okText="已保存，更新并刷新"
        confirmLoading={updating}
        onOk={update}
      >
        <Typography.Paragraph>
          新版本已准备好。更新会刷新当前页面，请先保存课程、待办和表单，并等待 AI 回复结束。
        </Typography.Paragraph>
        <Typography.Paragraph>
          确认后会先在本机保存核心数据恢复点，再更新页面；此步骤不需要云连接。
        </Typography.Paragraph>
        {updateError && <Alert type="error" showIcon message={updateError} />}
        <Typography.Paragraph type="secondary">
          点击“取消”可继续使用当前页面，稍后再更新。未保存的输入不会自动迁移。
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
