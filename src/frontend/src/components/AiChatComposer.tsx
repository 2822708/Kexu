import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent } from 'react'
import { Button, Input, Popconfirm, Tooltip, message } from 'antd'
import {
  AudioOutlined,
  CloseOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { aiApi } from '../api'
import { useSpeechConsent, useSpeechInput } from '../hooks/useSpeechInput'
import { extractImportFileText, isSupportedImage, MAX_IMAGE_BYTES } from '../utils/importFiles'
import {
  appendChatText,
  chatMaterialText,
  MAX_CHAT_CHARS,
  MAX_CHAT_IMAGES,
  readChatImage,
} from '../utils/chatImport'
import { useMediaQuery } from '../hooks/useMediaQuery'

interface AiChatComposerProps {
  value: string
  onChange: (text: string) => void
  onSend: (content: string) => Promise<void>
  onStop: () => void
  sending: boolean
  disabled: boolean
  sendDisabled: boolean
  scopeKey: string
}

interface PendingImage {
  id: number
  file: File
}

type Busy = 'files' | 'images' | null

export default function AiChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  disabled,
  sendDisabled,
  scopeKey,
}: AiChatComposerProps) {
  const mobile = useMediaQuery('(max-width: 767px)')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<PendingImage[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [dragging, setDragging] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [speechConsent, setSpeechConsent] = useSpeechConsent()
  const mountedRef = useRef(true)
  const scopeRef = useRef(scopeKey)
  const valueRef = useRef(value)
  const disabledRef = useRef(disabled)
  const sendDisabledRef = useRef(sendDisabled)
  const sendingRef = useRef(sending)
  const busyRef = useRef<Busy>(null)
  const sendLockRef = useRef(false)
  const operationRef = useRef(0)
  const imagesRef = useRef<PendingImage[]>([])
  const nextImageRef = useRef(0)
  const dragDepthRef = useRef(0)
  const composingRef = useRef(false)
  const voiceRef = useRef<{ scope: string; base: string } | null>(null)
  const abortSpeechRef = useRef<() => void>(() => undefined)
  scopeRef.current = scopeKey
  valueRef.current = value
  disabledRef.current = disabled
  sendDisabledRef.current = sendDisabled
  sendingRef.current = sending

  const updateDraft = (text: string) => {
    valueRef.current = text
    onChange(text)
  }

  const speech = useSpeechInput({
    onStart: () => {
      voiceRef.current = { scope: scopeRef.current, base: valueRef.current }
      setConsentOpen(false)
    },
    onTranscript: (text) => {
      const session = voiceRef.current
      if (
        !session ||
        !mountedRef.current ||
        session.scope !== scopeRef.current ||
        disabledRef.current
      )
        return
      try {
        updateDraft(text ? appendChatText(session.base, text) : session.base)
      } catch (error) {
        voiceRef.current = null
        abortSpeechRef.current()
        message.warning(error instanceof Error ? error.message : '语音内容过长，请分次输入')
      }
    },
    onError: (error) => {
      if (mountedRef.current && voiceRef.current?.scope === scopeRef.current) message.error(error)
    },
  })
  abortSpeechRef.current = speech.abort

  useEffect(() => {
    const operation = operationRef
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operation.current++
      voiceRef.current = null
      abortSpeechRef.current()
    }
  }, [])

  useEffect(() => {
    // Switching conversations or schedules invalidates every pending local result.
    operationRef.current++
    busyRef.current = null
    sendLockRef.current = false
    imagesRef.current = []
    dragDepthRef.current = 0
    voiceRef.current = null
    abortSpeechRef.current()
    setImages([])
    setBusy(null)
    setDragging(false)
    setConsentOpen(false)
    composingRef.current = false
  }, [scopeKey, disabled])

  const isCurrent = (scope: string, operation: number) =>
    mountedRef.current &&
    scopeRef.current === scope &&
    operationRef.current === operation &&
    !disabledRef.current

  const importFiles = async (files: File[]) => {
    if (
      !files.length ||
      disabledRef.current ||
      busyRef.current ||
      sendLockRef.current ||
      speech.recording
    )
      return
    const scope = scopeRef.current
    const operation = ++operationRef.current
    busyRef.current = 'files'
    setBusy('files')
    try {
      const addedImages: PendingImage[] = []
      const material: string[] = []
      for (const file of files) {
        if (isSupportedImage(file)) {
          if (file.size > MAX_IMAGE_BYTES) throw new Error(`图片不能超过 4 MiB：${file.name}`)
          if (imagesRef.current.length + addedImages.length >= MAX_CHAT_IMAGES) {
            throw new Error(`一次最多附带 ${MAX_CHAT_IMAGES} 张图片，请分批发送`)
          }
          addedImages.push({ id: ++nextImageRef.current, file })
        } else {
          const text = await extractImportFileText(file)
          if (!isCurrent(scope, operation)) return
          material.push(chatMaterialText(file.name, text))
        }
      }
      if (!isCurrent(scope, operation)) return
      // Read the latest value after extraction, preserving text typed while it ran.
      const nextDraft = material.length
        ? appendChatText(valueRef.current, material.join('\n\n'))
        : valueRef.current
      if (material.length) updateDraft(nextDraft)
      imagesRef.current = [...imagesRef.current, ...addedImages]
      setImages(imagesRef.current)
    } catch (error) {
      if (isCurrent(scope, operation))
        message.error(error instanceof Error ? error.message : '文件读取失败，原草稿已保留')
    } finally {
      if (isCurrent(scope, operation)) {
        busyRef.current = null
        setBusy(null)
      }
    }
  }

  const send = async () => {
    if (
      disabledRef.current ||
      sendDisabledRef.current ||
      sendingRef.current ||
      sendLockRef.current ||
      busyRef.current ||
      speech.recording ||
      composingRef.current
    )
      return
    const draft = valueRef.current.trim()
    const pending = imagesRef.current
    if (!draft && !pending.length) return
    if (draft.length > MAX_CHAT_CHARS) {
      message.warning(`消息不能超过 ${MAX_CHAT_CHARS} 字，请缩短后发送`)
      return
    }
    const scope = scopeRef.current
    const operation = ++operationRef.current
    sendLockRef.current = true
    try {
      let content = draft
      if (pending.length) {
        busyRef.current = 'images'
        setBusy('images')
        for (const image of pending) {
          const dataUrl = await readChatImage(image.file)
          if (!isCurrent(scope, operation)) return
          const result = await aiApi.parseImageText(dataUrl)
          if (!isCurrent(scope, operation)) return
          if (!result.text.trim()) throw new Error(`图片中未识别到文字：${image.file.name}`)
          content = appendChatText(content, chatMaterialText(image.file.name, result.text, true))
        }
      }
      if (!isCurrent(scope, operation) || sendDisabledRef.current) return
      // OCR failures leave everything untouched. Once prepared, the parent restores
      // this complete payload if its normal chat request fails.
      updateDraft(content)
      imagesRef.current = []
      setImages([])
      busyRef.current = null
      setBusy(null)
      await onSend(content)
    } catch (error) {
      if (isCurrent(scope, operation))
        message.error(error instanceof Error ? error.message : '发送准备失败，草稿已保留')
    } finally {
      if (isCurrent(scope, operation)) {
        sendLockRef.current = false
        busyRef.current = null
        setBusy(null)
      }
    }
  }

  const canImport = !disabled && !busy && !speech.recording && !sendLockRef.current
  const handlesDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).some((type) => type === 'Files' || type === 'text/plain')

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!handlesDrag(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragging(false)
    if (!canImport) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length) {
      void importFiles(files)
      return
    }
    const text = event.dataTransfer.getData('text/plain')
    if (text) {
      try {
        updateDraft(appendChatText(valueRef.current, text))
      } catch (error) {
        message.warning(error instanceof Error ? error.message : '拖入内容过长')
      }
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      if (canImport) void importFiles(files)
    }
  }

  const startVoice = () => {
    if (disabledRef.current || busyRef.current || sendLockRef.current || sendingRef.current) return
    voiceRef.current = { scope: scopeRef.current, base: valueRef.current }
    speech.start()
  }

  const micDisabled = !speech.recording && (disabled || !!busy || sending || !speech.supported)
  const micTitle = speech.recording
    ? '停止语音输入'
    : !speech.supported
      ? '当前浏览器不支持语音识别，可直接输入或拖入文件'
      : '语音输入'
  const mic = (
    <Tooltip title={micTitle}>
      <Button
        className="ai-chat-composer-mic"
        type="text"
        size="small"
        danger={speech.recording}
        disabled={micDisabled}
        aria-label={micTitle}
        aria-pressed={speech.recording}
        icon={speech.recording ? <StopOutlined /> : <AudioOutlined />}
        onClick={() => {
          if (speech.recording) speech.stop()
          else if (speechConsent) startVoice()
          else setConsentOpen(true)
        }}
      />
    </Tooltip>
  )

  return (
    <div className="chat-input-bar ai-chat-composer">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept=".txt,.md,.csv,.html,.htm,.json,.pdf,.docx,image/png,image/jpeg,image/webp"
        aria-label="选择聊天附件"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void importFiles(files)
        }}
      />
      <Button
        className="ai-chat-attachment"
        aria-label="添加文件或截图"
        title="添加文件或截图"
        icon={<PaperClipOutlined />}
        disabled={!canImport || sending}
        onClick={() => fileInputRef.current?.click()}
      />
      <div
        className={`ai-chat-composer-field${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragEnter={(event) => {
          if (!handlesDrag(event)) return
          event.preventDefault()
          dragDepthRef.current++
          if (canImport) setDragging(true)
        }}
        onDragOver={(event) => {
          if (!handlesDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = canImport ? 'copy' : 'none'
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (!dragDepthRef.current) setDragging(false)
        }}
        onDrop={onDrop}
      >
        {!!images.length && (
          <div className="ai-chat-composer-images">
            {images.map((image) => (
              <span className="ai-chat-composer-image" key={image.id}>
                <Tooltip
                  title={`${image.file.name} · 点击发送后会将图片交给已配置的 AI 服务识别文字`}
                >
                  <span className="ai-chat-composer-image-name">{image.file.name}</span>
                </Tooltip>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={`移除图片 ${image.file.name}`}
                  disabled={disabled || !!busy || sending}
                  onClick={() => {
                    imagesRef.current = imagesRef.current.filter((item) => item.id !== image.id)
                    setImages(imagesRef.current)
                  }}
                />
              </span>
            ))}
          </div>
        )}
        <Input.TextArea
          className="ai-chat-composer-text"
          value={value}
          onChange={(event) => {
            if (event.target.value.length > MAX_CHAT_CHARS) {
              message.warning(`消息不能超过 ${MAX_CHAT_CHARS} 字，原草稿已保留`)
              return
            }
            updateDraft(event.target.value)
          }}
          placeholder={
            mobile
              ? '描述你的安排，可附文件或截图'
              : '描述你的安排，或拖入文件、截图；Enter 发送，Shift+Enter 换行'
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={disabled}
          readOnly={speech.recording || busy === 'images'}
          aria-label="AI 消息输入"
          onPaste={onPaste}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onPressEnter={(event) => {
            if (mobile) return
            if (
              event.shiftKey ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              composingRef.current
            )
              return
            event.preventDefault()
            void send()
          }}
        />
        {busy === 'files' && (
          <span className="ai-chat-composer-status" role="status">
            <LoadingOutlined spin /> 读取文件…
          </span>
        )}
        <Popconfirm
          title="启用语音输入"
          description={
            <span className="ai-chat-composer-consent">
              浏览器可能将音频发送给在线识别服务。是否同意并开始录音？
            </span>
          }
          open={consentOpen && !speechConsent}
          onOpenChange={(open) => {
            if (!open) setConsentOpen(false)
          }}
          onConfirm={() => {
            setSpeechConsent(true)
            setConsentOpen(false)
            startVoice()
          }}
          onCancel={() => setConsentOpen(false)}
          okText="同意并开始"
          cancelText="取消"
          placement="topRight"
        >
          {mic}
        </Popconfirm>
      </div>
      {sending ? (
        <Button className="assistant-send-button" danger icon={<StopOutlined />} onClick={onStop}>
          停止
        </Button>
      ) : (
        <Tooltip
          title={
            images.length ? '发送后将图片交给已配置的 AI 服务识别，再生成待确认提案' : undefined
          }
        >
          <Button
            className="assistant-send-button"
            type="primary"
            icon={<SendOutlined />}
            loading={busy === 'images'}
            disabled={
              disabled ||
              sendDisabled ||
              busy === 'files' ||
              speech.recording ||
              (!value.trim() && !images.length)
            }
            onClick={() => void send()}
          >
            {busy === 'images' ? '识图中' : '发送'}
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
