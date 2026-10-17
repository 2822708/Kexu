import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Space,
  Typography,
  message,
} from 'antd'
import { AudioOutlined, StopOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { taskApi } from '../api'
import { useApp } from '../store/AppContext'
import { useSpeechConsent, useSpeechInput } from '../hooks/useSpeechInput'
import { dayjs } from '../utils/schedule'
import type { TaskDraft } from '../types'

interface VoiceAssistantCtx {
  /** 打开「语音新增待办」弹窗；任何页面都能调 */
  openVoiceTask: () => void
  supported: boolean
}

const Ctx = createContext<VoiceAssistantCtx>({
  openVoiceTask: () => {},
  supported: false,
})

export const useVoiceAssistant = () => useContext(Ctx)

/**
 * 全局语音助手（语音新增待办）。
 *
 * <b>为什么要把录音提到 Provider 层</b>：`useSpeechInput` 在组件卸载时会 abort，
 * 而录音途中用户很可能切页面、关弹窗、触发重挂载——绑在任何会重挂载的组件上，
 * 录音都会被无声打断。提到这里（挂在 AppLayout 下，随应用常驻）才稳。
 *
 * 模块级单例 `activeSpeechOwner` 已经保证了全局同一时刻只有一个录音会话，
 * 所以这里和聊天框、导入浮窗的语音输入天然互斥，不会互相打断成乱码。
 */
export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const { refreshAll } = useApp()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState<Dayjs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [speechConsent, setSpeechConsent] = useSpeechConsent()
  // onTranscript 给的是累计全文，必须存住录音开始前的 base 再拼接
  const baseTextRef = useRef('')

  const { recording, start, stop, abort, supported } = useSpeechInput({
    onStart: () => {
      setError('')
      baseTextRef.current = title.trim()
    },
    onTranscript: (transcript) => {
      const next = [baseTextRef.current, transcript].filter(Boolean).join(' ')
      setTitle(next.slice(0, 200))
    },
    onError: setError,
  })

  const reset = useCallback(() => {
    abort()
    setTitle('')
    setDeadline(null)
    setError('')
  }, [abort])

  const close = useCallback(() => {
    if (busy || recording) return
    reset()
    setOpen(false)
  }, [busy, recording, reset])

  const openVoiceTask = useCallback(() => {
    reset()
    setOpen(true)
  }, [reset])

  const startVoice = () => {
    if (busy || recording) return
    baseTextRef.current = title.trim()
    start()
  }

  const submit = async () => {
    const value = title.trim()
    if (!value || busy || recording) return
    setBusy(true)
    setError('')
    try {
      const draft: TaskDraft = {
        title: value,
        type: 'OTHER',
        deadline: deadline ? deadline.hour(23).minute(59).format('YYYY-MM-DDTHH:mm:ss') : null,
        priority: 2,
        description: '',
      }
      await taskApi.create([draft])
      message.success('待办已创建')
      // 首页的今日必做要跟着更新，否则用户刚建的待办在首页看不见
      await refreshAll().catch(() => undefined)
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建待办失败')
    } finally {
      setBusy(false)
    }
  }

  // 卸载时确保录音被释放
  useEffect(() => () => abort(), [abort])

  const value = useMemo<VoiceAssistantCtx>(
    () => ({ openVoiceTask, supported }),
    [openVoiceTask, supported],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        title={
          <Space size={6}>
            <AudioOutlined />
            <span>语音新增待办</span>
          </Space>
        }
        open={open}
        onCancel={close}
        okText="创建待办"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: !title.trim() || recording }}
        onOk={() => void submit()}
        width={480}
        destroyOnClose
      >
        <Space direction="vertical" size={10} style={{ display: 'flex' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            说话即可自动转成文字，确认后创建为一条待办。适合走路、食堂、图书馆这些不方便打字的场景。
          </Typography.Text>

          <Input.TextArea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={200}
            showCount
            placeholder="点下面的按钮开始说话，也可以直接打字改"
            disabled={busy || recording}
          />

          <Space wrap>
            {recording ? (
              <Button icon={<StopOutlined />} onClick={stop} danger>
                停止录音
              </Button>
            ) : (
              <Button
                icon={<AudioOutlined />}
                onClick={startVoice}
                disabled={!supported || !speechConsent || busy}
              >
                开始说话
              </Button>
            )}
            <DatePicker
              value={deadline}
              onChange={setDeadline}
              placeholder="截止时间（可选）"
              disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
              disabled={busy || recording}
            />
          </Space>

          {!supported && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前浏览器不支持语音识别，可以直接打字创建。
            </Typography.Text>
          )}

          {supported && (
            <Checkbox
              checked={speechConsent}
              onChange={(e) => setSpeechConsent(e.target.checked)}
            >
              我已了解语音可能由浏览器在线服务处理
            </Checkbox>
          )}

          {recording && (
            <Typography.Text style={{ fontSize: 12, color: 'var(--accent)' }}>
              ● 正在听，说完点「停止录音」
            </Typography.Text>
          )}

          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      </Modal>
    </Ctx.Provider>
  )
}
