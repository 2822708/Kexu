import { Component, useEffect, useState, type ReactNode } from 'react'

export function BootLoading({ waitingForPage = false }: { waitingForPage?: boolean }) {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!waitingForPage) return
    const timer = window.setTimeout(() => setTimedOut(true), 15_000)
    return () => window.clearTimeout(timer)
  }, [waitingForPage])

  if (timedOut) return <BootError description="页面加载超时，请重新打开。" />
  return (
    <div className="boot-splash">
      <div className="boot-status" role="status">
        <span className="boot-spinner" aria-hidden="true" />
        <p className="boot-message">完美人生正在到来</p>
      </div>
    </div>
  )
}

export function BootError({
  title = 'Kexu 启动失败',
  description,
  onRetry = () => window.location.reload(),
}: {
  title?: string
  description: string
  onRetry?: () => void
}) {
  return (
    <div className="boot-splash">
      <div className="boot-error">
        <p role="alert">
          <strong>{title}</strong>
          <br />
          {description}
        </p>
        <button type="button" onClick={onRetry}>
          重新加载
        </button>
      </div>
    </div>
  )
}

export class BootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidMount() {
    window.dispatchEvent(new Event('kexu:react-mounted'))
  }

  render() {
    return this.state.failed
      ? <BootError description="页面资源或应用初始化失败，请重新打开。" />
      : this.props.children
  }
}
