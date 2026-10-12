import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Typography } from 'antd'
import { DownloadOutlined, ReloadOutlined, WifiOutlined } from '@ant-design/icons'
import { findWaitingUpdate } from '../pwa/updateState'
import '../pwa/pwa.css'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const enabled = import.meta.env.MODE === 'mobile'
const inStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Mount once outside routed pages so pending update/install prompts survive navigation. */
export default function PwaStatus() {
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
  const updateRequested = useRef(false)

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
    if (
      !enabled ||
      !import.meta.env.PROD ||
      !window.isSecureContext ||
      !('serviceWorker' in navigator)
    )
      return
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    let installingWorker: ServiceWorker | null = null
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
      if (installingWorker?.state === 'installed') observeWaiting()
    }
    const updateFound = () => {
      installingWorker?.removeEventListener('statechange', stateChanged)
      installingWorker = registration?.installing ?? null
      installingWorker?.addEventListener('statechange', stateChanged)
      observeWaiting()
    }
    const controllerChanged = () => {
      // Another tab's update or initial activation must never reload this page.
      if (updateRequested.current) window.location.reload()
    }
    const checkUpdate = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void registration?.update().catch(() => {
          /* Keep the current version usable on a weak network. */
        })
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    document.addEventListener('visibilitychange', checkUpdate)
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
      })
      .catch(() => {
        if (active) setPwaError('安装准备未完成。页面仍可联网使用；请联网后重新打开重试。')
      })
    return () => {
      active = false
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
      document.removeEventListener('visibilitychange', checkUpdate)
      registration?.removeEventListener('updatefound', updateFound)
      installingWorker?.removeEventListener('statechange', stateChanged)
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

  const update = () => {
    if (!waiting || updating) return
    updateRequested.current = true
    setUpdating(true)
    // Another tab may have already activated this update. Only this explicit
    // saved-work confirmation is allowed to refresh the current tab.
    if (waiting.state === 'activated' || waiting.state === 'redundant') {
      window.location.reload()
      return
    }
    waiting.postMessage({ type: 'ACTIVATE_SAVED_UPDATE' })
  }

  if (!enabled) return null
  return (
    <>
      {!online && (
        <div className="pwa-offline" role="status">
          <WifiOutlined /> 当前离线。数据无法刷新或保存，AI 暂不可用。
        </div>
      )}
      <aside className="pwa-controls" aria-label="应用安装与更新">
        {waiting && (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => setUpdateOpen(true)}>
            有新版本
          </Button>
        )}
        {!standalone && (
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={installing}
            onClick={() => void install()}
          >
            安装
          </Button>
        )}
      </aside>
      <Modal
        title="将大切课程表添加到主屏幕"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={<Button onClick={() => setGuideOpen(false)}>知道了</Button>}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>
            安装后可从手机主屏幕打开。课表、待办与 AI 仍需要联网连接服务。
          </Typography.Paragraph>
          {!window.isSecureContext && (
            <Alert
              type="info"
              showIcon
              message="此地址无法准备安装。请使用受浏览器信任的 HTTPS 地址；当前页面仍可在线使用。"
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
            请保持使用同一个地址和浏览器。本机身份保存在浏览器中；清除网站数据会丢失本机连接信息。
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
        <Typography.Paragraph type="secondary">
          点击“取消”可继续使用当前页面，稍后再更新。未保存的输入不会自动迁移。
        </Typography.Paragraph>
      </Modal>
    </>
  )
}
