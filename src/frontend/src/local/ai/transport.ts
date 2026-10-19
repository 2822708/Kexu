import {
  completionUrl,
  subscribeAiSettings,
  validateAiSettings,
  type AiConnectionSettings,
} from './settings'

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}
export interface CompletionLimits {
  maxBytes: number
  maxChars: number
  totalMs: number
  idleMs: number
}
export const DEFAULT_COMPLETION_LIMITS: CompletionLimits = {
  maxBytes: 1024 * 1024,
  maxChars: 100000,
  totalMs: 90000,
  idleMs: 20000,
}

function aborted() {
  return new DOMException('请求已取消', 'AbortError')
}

/** Initiate cleanup but never let an uncooperative underlying stream block user cancellation. */
async function cancelBounded(cancel: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      cancel().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 100)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted())
      return
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('AI响应停顿过久，请稍后重试'))
    }, idleMs)
    const onAbort = () => {
      cleanup()
      reject(aborted())
    }
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/** A complete terminal marker and natural finish are both required before any proposal is saved. */
export async function consumeCompletionSse(
  response: Response,
  signal: AbortSignal,
  onDelta?: (delta: string) => void,
  limits = DEFAULT_COMPLETION_LIMITS,
): Promise<string> {
  if (!response.body) throw new Error('AI服务没有返回可读取的数据流')
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))
    throw new Error('AI服务未返回兼容SSE流，请检查接口地址和模型')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let content = ''
  let bytes = 0
  let finished = false
  let terminal = false
  let successful = false
  const process = (block: string) => {
    const payload = block
      .split(/\r\n|\r|\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!payload.trim()) return
    if (terminal) throw new Error('AI在结束标记后返回了多余数据')
    if (payload.trim() === '[DONE]') {
      terminal = true
      return
    }
    let event: unknown
    try {
      event = JSON.parse(payload)
    } catch {
      throw new Error('AI流包含损坏的数据，未生成提案')
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('AI流结构无效')
    const chunk = event as Record<string, unknown>
    if (chunk.error) throw new Error('AI服务返回错误，未生成提案')
    if (!Array.isArray(chunk.choices)) throw new Error('AI流缺少choices字段')
    if (chunk.choices.length > 1) throw new Error('AI流返回多个候选，不支持自动选择')
    for (const choice of chunk.choices as Array<Record<string, unknown>>) {
      if (choice.index !== undefined && choice.index !== 0) throw new Error('AI候选序号无效')
      const delta = choice.delta
      if (!delta || typeof delta !== 'object' || Array.isArray(delta))
        throw new Error('AI流缺少delta字段')
      const data = delta as Record<string, unknown>
      if (data.tool_calls || data.function_call)
        throw new Error('该接口返回了工具调用；请使用支持JSON回答的聊天模型')
      if (data.content != null && typeof data.content !== 'string')
        throw new Error('AI回复正文类型无效')
      if (typeof data.content === 'string') {
        if (finished && data.content) throw new Error('AI在完成后继续输出正文')
        content += data.content
        if (content.length > limits.maxChars) throw new Error('AI回复超过长度上限')
        onDelta?.(data.content)
      }
      if (choice.finish_reason != null) {
        if (choice.finish_reason !== 'stop')
          throw new Error(
            choice.finish_reason === 'length'
              ? 'AI回复被截断，未生成提案，请缩短请求'
              : 'AI未正常完成回复，未生成提案',
          )
        finished = true
      }
    }
  }
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal, limits.idleMs)
      if (done) {
        buffer += decoder.decode()
        break
      }
      bytes += value.byteLength
      if (bytes > limits.maxBytes) throw new Error('AI数据流超过大小上限')
      buffer += decoder.decode(value, { stream: true })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer)) !== null) {
        process(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
      }
      // Do not wait for a provider to close a keepalive connection after its terminal event.
      if (terminal) break
    }
    if (signal.aborted) throw aborted()
    if (buffer.trim()) {
      // A pending unterminated event is truncation, including a terminal marker without a blank line.
      if (!terminal) throw new Error('AI流不完整，未生成提案')
      if (!buffer.split(/\r\n|\r|\n/).every((line) => !line.trim() || line.startsWith(':')))
        throw new Error('AI结束标记后存在未完成事件')
    }
    if (!terminal || !finished || !content.trim())
      throw new Error('AI连接提前结束或没有完整回答，未生成提案')
    successful = true
    return content
  } finally {
    // Explicit cancellation closes the upstream body on success, error and user cancellation.
    try {
      await cancelBounded(() => reader.cancel(successful ? 'complete' : 'incomplete'))
    } catch {
      /* network already closed */
    }
    reader.releaseLock()
  }
}

export async function requestCompletion(
  settings: AiConnectionSettings,
  messages: CompletionMessage[],
  options: {
    signal?: AbortSignal
    onDelta?: (delta: string) => void
    limits?: CompletionLimits
  } = {},
): Promise<string> {
  const connection = validateAiSettings(settings)
  if (!connection.endpoint || !connection.model || !connection.apiKey)
    throw new Error('请先设置你选择的AI服务地址、模型和API Key')
  const controller = new AbortController()
  const limits = options.limits ?? DEFAULT_COMPLETION_LIMITS
  let timedOut = false
  const onAbort = () => controller.abort()
  if (options.signal?.aborted) throw aborted()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const unsubscribeSettings =
    typeof window !== 'undefined' ? subscribeAiSettings(onAbort) : () => {}
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, limits.totalMs)
  try {
    let response: Response
    try {
      response = await fetch(completionUrl(connection.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.apiKey}`,
        },
        body: JSON.stringify({ model: connection.model, messages, stream: true }),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
    } catch (error) {
      if (controller.signal.aborted) throw aborted()
      // Browser intentionally does not reveal whether CORS, DNS, TLS or a network failure caused this.
      if (error instanceof TypeError || (error as { name?: unknown } | null)?.name === 'TypeError')
        // eslint-disable-next-line preserve-caught-error -- Do not retain exceptions that may contain request credentials.
        throw new Error(
          '无法直连AI服务：请检查网络、HTTPS证书及服务是否允许本站CORS（Authorization、Content-Type）。快照云不会代理AI。',
        )
      // eslint-disable-next-line preserve-caught-error -- Provider exceptions are intentionally replaced with a safe public error.
      throw new Error('无法连接所选AI服务，请检查网络和服务设置')
    }
    if (!response.ok) {
      if (response.body) await cancelBounded(() => response.body!.cancel())
      throw new Error(
        response.status === 401 || response.status === 403
          ? `AI鉴权失败（HTTP ${response.status}），请检查本机Key与模型权限`
          : response.status === 429
            ? 'AI服务限流或配额不足（HTTP 429），请稍后重试'
            : `AI请求失败（HTTP ${response.status}），请检查所选服务`,
      )
    }
    const result = await consumeCompletionSse(response, controller.signal, options.onDelta, limits)
    if (connection.apiKey.length >= 8 && result.includes(connection.apiKey))
      throw new Error('AI回复意外包含连接凭据，已阻止保存和显示')
    return result
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Never attach a credential-bearing provider cause to a public timeout.
    if (timedOut) throw new Error('AI请求超过90秒上限，已取消且未生成提案')
    if (options.signal?.aborted) throw aborted()
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    unsubscribeSettings()
    controller.abort()
  }
}

/** This small real request tests the same POST/auth/SSE/CORS path without sending local data. */
export async function testAiConnection(
  settings: AiConnectionSettings,
  signal?: AbortSignal,
): Promise<{ ok: true; message: string }> {
  await requestCompletion(
    settings,
    [{ role: 'user', content: '这是连接测试。请只回复“连接成功”，不要执行操作。' }],
    { signal },
  )
  return {
    ok: true,
    message: '连接成功：当前浏览器已完成一次带鉴权的SSE请求。该测试可能产生少量模型费用。',
  }
}
