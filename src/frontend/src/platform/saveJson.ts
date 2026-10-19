import { NATIVE_SHELL } from '../local/mode'

export const SHELL_ORIGIN = 'https://appassets.androidplatform.net'
const MAX_BYTES = 11 * 1024 * 1024
interface NativeReply {
  type?: string
  id?: string
  ok?: boolean
  cancelled?: boolean
  error?: string
}
interface AndroidPort {
  postMessage(message: string): void
  onmessage?: (event: { data: unknown }) => void
}
interface WindowsPort {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}
type ShellWindow = Window & { KexuNative?: AndroidPort; chrome?: { webview?: WindowsPort } }
let pending = false

/** Only JSON export crosses this channel; the host never receives arbitrary paths or JavaScript. */
async function saveThroughHost(text: string, filename: string): Promise<boolean> {
  if (window.location.origin !== SHELL_ORIGIN)
    throw new Error('应用地址不正确，已停止导出。请重新打开应用。')
  if (pending) throw new Error('请先完成或取消当前保存窗口。')
  const host = window as ShellWindow
  const android = host.KexuNative
  const windows = host.chrome?.webview
  if (!android && !windows)
    throw new Error('当前应用无法打开保存窗口，请更新应用或系统 WebView 后重试。')
  const id = crypto.randomUUID()
  pending = true
  return new Promise<boolean>((resolve, reject) => {
    const previous = android?.onmessage
    const finish = (result: boolean | Error) => {
      pending = false
      clearTimeout(timeout)
      if (android) android.onmessage = previous
      else windows?.removeEventListener('message', receive)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const receive = (event: { data: unknown }) => {
      let value: NativeReply
      try {
        value = (
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        ) as NativeReply
      } catch {
        return
      }
      if (!value || value.type !== 'save-json-result' || value.id !== id) return
      if (value.ok === true) finish(true)
      else if (value.cancelled === true) finish(false)
      else
        finish(
          new Error(
            typeof value.error === 'string'
              ? value.error.slice(0, 500)
              : '文件未能保存，请保留当前页面后重试。',
          ),
        )
    }
    if (android) android.onmessage = receive
    else windows?.addEventListener('message', receive)
    const timeout = setTimeout(
      () => finish(new Error('保存等待超时，请确认系统文件窗口已关闭后重试。')),
      5 * 60_000,
    )
    const request = { type: 'save-json', id, filename, text }
    try {
      if (android) android.postMessage(JSON.stringify(request))
      else windows!.postMessage(request)
    } catch {
      finish(new Error('无法打开系统保存窗口，请重试。'))
    }
  })
}

export async function saveJsonFile(value: unknown, filename: string): Promise<boolean> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/.test(filename) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(filename)
  )
    throw new Error('导出文件名不合法')
  // Keep the byte representation used by the snapshot codec's import limit.
  // Pretty-printing can make a valid near-limit snapshot too large to restore.
  const text = JSON.stringify(value)
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new Error('导出内容超过11MB限制或格式不正确')
  if (NATIVE_SHELL) return saveThroughHost(text, filename)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
