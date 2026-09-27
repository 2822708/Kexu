import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  List,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import AiActionCard from '../components/AiActionCard'
import { aiApi } from '../api'
import { useApp } from '../store/AppContext'
import type { AiConversation, AiMessage } from '../types'
import { formatWeekInfo } from '../utils/schedule'

const EXAMPLES = [
  '下周一3-4节加一节形势政策，地点待定',
  '把周三的高数从第3-4节改到第5-6节',
  '删掉周五上午的课，再加一条周三交实验报告的待办',
  '下周五下午5点前交高数作业',
]

/** 单个对话的流式进行状态 */
interface StreamState {
  phase: 'thinking' | 'text' | 'planning'
  text: string
  userText: string
}

export default function AiChatPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    activeSchedule,
    activeScheduleId,
    schedules,
    courses,
    exams,
    todos,
    recurringTodos,
    refreshCourses,
    refreshExams,
    refreshTodos,
    refreshRecurring,
  } = useApp()

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [conversations, setConversations] = useState<AiConversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [convPanelOpen, setConvPanelOpen] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [executingId, setExecutingId] = useState<number | null>(null)
  const [listMode, setListMode] = useState<'normal' | 'edit' | 'delete'>('normal')
  const [edits, setEdits] = useState<Record<number, string>>({})
  const [deleteSelected, setDeleteSelected] = useState<number[]>([])
  // 关键：流式状态按 conversationId 存储，避免串台到其他对话
  const [streams, setStreams] = useState<Record<number, StreamState>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeAbortRef = useRef<AbortController | null>(null)
  const currentIdRef = useRef<number | null>(null)
  const messagesRef = useRef<AiMessage[]>([])
  const messageRequestRef = useRef(0)
  const conversationRequestRef = useRef(0)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  const stream = currentId !== null ? streams[currentId] : undefined
  const sending = stream !== undefined || creatingConversation

  const changeConversation = useCallback((id: number | null, abort = true) => {
    if (id !== currentIdRef.current) {
      if (abort) activeAbortRef.current?.abort()
      messageRequestRef.current++
      messagesRef.current = []
      setMessages([])
      setMessageCursor(null)
      setLoadingOlder(false)
      setLoadingMessages(id !== null)
      currentIdRef.current = id
      setCurrentId(id)
    }
  }, [])

  useEffect(() => {
    return () => {
      activeAbortRef.current?.abort()
      messageRequestRef.current++
      conversationRequestRef.current++
      currentIdRef.current = null
    }
  }, [])

  useEffect(() => () => activeAbortRef.current?.abort(), [activeScheduleId])

  // 工作空间保护：每个对话绑定一个课表。当前课表与对话所属课表不一致时，
  // 禁止发送消息 / 执行或取消提案，避免串到其它课表的数据。
  const currentConv = conversations.find((c) => c.id === currentId) ?? null
  const workspaceMismatch =
    currentConv?.scheduleId != null && currentConv.scheduleId !== activeScheduleId
  const convScheduleName =
    currentConv?.scheduleId != null
      ? (schedules.find((s) => s.id === currentConv?.scheduleId)?.name ??
        `课表#${currentConv.scheduleId}`)
      : null

  const patchStream = useCallback((convId: number, patch: Partial<StreamState>) => {
    setStreams((prev) => {
      const cur = prev[convId]
      if (!cur) return prev
      return { ...prev, [convId]: { ...cur, ...patch } }
    })
  }, [])

  const clearStream = useCallback((convId: number) => {
    setStreams((prev) => {
      const next = { ...prev }
      delete next[convId]
      return next
    })
  }, [])

  useEffect(() => {
    aiApi
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false))
  }, [])

  const loadConversations = useCallback(async () => {
    const version = ++conversationRequestRef.current
    const page = await aiApi.pageConversations()
    if (version === conversationRequestRef.current) {
      setConversations(page.items)
      setConversationCursor(page.nextCursor)
    }
    return page.items
  }, [])

  const loadMoreConversations = async () => {
    if (!conversationCursor || loadingConversations) return
    const version = conversationRequestRef.current
    setLoadingConversations(true)
    try {
      const page = await aiApi.pageConversations(conversationCursor)
      if (version !== conversationRequestRef.current) return
      setConversations((old) => {
        const seen = new Set(old.map((item) => item.id))
        return [...old, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setConversationCursor(page.nextCursor)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载对话失败')
    } finally { setLoadingConversations(false) }
  }

  const refreshMessages = useCallback(async (id: number, preserveOlder = false) => {
    if (currentIdRef.current !== id) return
    const version = ++messageRequestRef.current
    const oldest = preserveOlder ? messagesRef.current[0]?.messageId : undefined
    let page = await aiApi.pageMessages(id)
    let next = page.items
    // Refresh only pages the user has explicitly loaded, keeping old action cards current.
    while (oldest !== undefined && page.nextCursor && next[0]?.messageId > oldest) {
      if (currentIdRef.current !== id || version !== messageRequestRef.current) return
      page = await aiApi.pageMessages(id, page.nextCursor)
      next = [...page.items, ...next]
    }
    if (currentIdRef.current !== id || version !== messageRequestRef.current) return
    messagesRef.current = next
    setMessages(next)
    setMessageCursor(page.nextCursor)
  }, [])

  const loadOlderMessages = async () => {
    if (currentId === null || !messageCursor || loadingOlder || sending) return
    const id = currentId
    const version = messageRequestRef.current
    const previousHeight = chatScrollRef.current?.scrollHeight ?? 0
    setLoadingOlder(true)
    try {
      const page = await aiApi.pageMessages(id, messageCursor)
      if (currentIdRef.current !== id || version !== messageRequestRef.current) return
      const existing = new Set(messagesRef.current.map((item) => item.messageId))
      const next = [...page.items.filter((item) => !existing.has(item.messageId)), ...messagesRef.current]
      messagesRef.current = next
      setMessages(next)
      setMessageCursor(page.nextCursor)
      requestAnimationFrame(() => {
        if (chatScrollRef.current && currentIdRef.current === id) {
          chatScrollRef.current.scrollTop += chatScrollRef.current.scrollHeight - previousHeight
        }
      })
    } catch (e) {
      if (currentIdRef.current === id) message.error(e instanceof Error ? e.message : '加载历史失败')
    } finally { if (currentIdRef.current === id) setLoadingOlder(false) }
  }

  useEffect(() => {
    loadConversations()
      .then((list) => {
        if (list.length > 0 && currentIdRef.current === null) changeConversation(list[0].id)
      })
      .catch((e: Error) => message.error(e.message))
  }, [loadConversations, changeConversation])

  useEffect(() => {
    const state = location.state as {
      quickImport?: { conversationId: number; scheduleId: number | null; prompt: string }
    } | null
    const draft = state?.quickImport
    if (!draft) return
    navigate(location.pathname, { replace: true, state: null })
    if (draft.scheduleId !== activeScheduleId) {
      message.warning('导入材料绑定的课表已变化，请切回对应课表后重试。')
      return
    }
    if (!Number.isSafeInteger(draft.conversationId) || !draft.prompt?.trim()) {
      message.error('导入内容无效，请重新导入。')
      return
    }
    changeConversation(draft.conversationId)
    setInput(draft.prompt)
  }, [location.state, location.pathname, navigate, activeScheduleId, changeConversation])

  useEffect(() => {
    if (currentId === null) {
      setLoadingMessages(false)
      return
    }
    setLoadingMessages(true)
    refreshMessages(currentId)
      .catch((e: Error) => { if (currentIdRef.current === currentId) message.error(e.message) })
      .finally(() => { if (currentIdRef.current === currentId) setLoadingMessages(false) })
  }, [currentId, refreshMessages])

  // 课表/待办变化时重新拉取消息，让失效提案立即显示
  const dataVersion = JSON.stringify([courses, exams, todos, recurringTodos])
  const previousDataVersionRef = useRef(dataVersion)
  useEffect(() => {
    if (previousDataVersionRef.current === dataVersion || currentId === null || sending) return
    previousDataVersionRef.current = dataVersion
    refreshMessages(currentId, true)
      .catch(() => undefined)
  }, [dataVersion, currentId, sending, refreshMessages])

  // 只在「有新消息流式输出」或「切换对话加载完成」时自动滚到底部；
  // 执行/取消提案只是更新消息状态，不触发滚动，保留当前位置。
  useEffect(() => {
    if (stream) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stream?.text, stream?.phase])

  useEffect(() => {
    if (currentId !== null && !loadingMessages) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentId, loadingMessages])

  const newConversation = async () => {
    try {
      const conv = await aiApi.createConversation(activeScheduleId)
      await loadConversations()
      changeConversation(conv.id)
      setConvPanelOpen(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建对话失败')
    }
  }

  const deleteConversation = async (id: number) => {
    try {
      if (id === currentIdRef.current) activeAbortRef.current?.abort()
      await aiApi.deleteConversation(id)
      clearStream(id)
      const list = await loadConversations()
      if (currentIdRef.current === id) changeConversation(list.length > 0 ? list[0].id : null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const startBatchEdit = () => {
    setEdits(Object.fromEntries(conversations.map((c) => [c.id, c.title || ''])))
    setListMode('edit')
  }

  const cancelBatchEdit = () => {
    setListMode('normal')
    setEdits({})
  }

  const saveBatchEdit = async () => {
    try {
      await Promise.all(
        conversations.map((c) => {
          const t = (edits[c.id] ?? '').trim()
          if (t && t !== c.title) return aiApi.renameConversation(c.id, t)
          return Promise.resolve()
        }),
      )
      await loadConversations()
      setListMode('normal')
      setEdits({})
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  const startBatchDelete = () => {
    setDeleteSelected([])
    setListMode('delete')
  }

  const cancelBatchDelete = () => {
    setListMode('normal')
    setDeleteSelected([])
  }

  const toggleDeleteSelect = (id: number) => {
    setDeleteSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const doBatchDelete = async () => {
    if (deleteSelected.length === 0) return
    await Promise.all(deleteSelected.map((id) => deleteConversation(id)))
    setListMode('normal')
    setDeleteSelected([])
  }

  const send = async () => {
    const content = input.trim()
    if (!content || sending || activeAbortRef.current) return
    if (workspaceMismatch) {
      message.warning('该对话属于另一个课表，请切换到对应课表后再继续，或新建对话')
      return
    }

    let convId = currentId
    const controller = new AbortController()
    activeAbortRef.current = controller
    setInput('')

    try {
      if (convId === null) {
        setCreatingConversation(true)
        const conv = await aiApi.createConversation(activeScheduleId)
        if (controller.signal.aborted) return
        convId = conv.id
        changeConversation(conv.id, false)
        setConvPanelOpen(false)
        await loadConversations()
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建对话失败')
      setInput(content)
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      return
    } finally {
      setCreatingConversation(false)
      if (controller.signal.aborted && activeAbortRef.current === controller) activeAbortRef.current = null
    }

    if (controller.signal.aborted) return
    const cid = convId
    setStreams((prev) => ({
      ...prev,
      [cid]: { phase: 'thinking', text: '', userText: content },
    }))

    try {
      await aiApi.sendMessageStream(cid, content, activeScheduleId, {
        onThinking: () => patchStream(cid, { phase: 'thinking' }),
        onText: (delta) =>
          setStreams((prev) => {
            const cur = prev[cid]
            if (!cur) return prev
            return { ...prev, [cid]: { ...cur, phase: 'text', text: cur.text + delta } }
          }),
        onPlanning: () => patchStream(cid, { phase: 'planning' }),
      }, controller.signal)
      clearStream(cid)
      await refreshMessages(cid)
      await loadConversations()
    } catch (e) {
      clearStream(cid)
      if (!controller.signal.aborted) message.error(e instanceof Error ? e.message : '发送失败')
      try {
        await refreshMessages(cid, true)
      } catch {
        // 忽略
      }
      if (!controller.signal.aborted && currentIdRef.current === cid) setInput((draft) => draft || content)
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null
    }
  }

  const stopSending = () => activeAbortRef.current?.abort()

  const execute = async (actionId: number) => {
    if (currentId === null || executingId !== null || sending) return
    if (workspaceMismatch) {
      message.warning('该对话属于另一个课表，无法在当前课表下执行')
      return
    }
    setExecutingId(actionId)
    try {
      await aiApi.execute(currentId, actionId)
      message.success('操作已执行')
      await refreshMessages(currentId, true)
      try {
        await Promise.all([refreshCourses(), refreshExams(), refreshTodos(), refreshRecurring()])
      } catch (e) {
        message.warning(
          `操作已执行，但刷新部分数据失败：${e instanceof Error ? e.message : '请稍后重试'}`,
        )
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '执行失败')
      try {
        await refreshMessages(currentId, true)
      } catch {
        // 忽略
      }
    } finally {
      setExecutingId(null)
    }
  }

  const reject = async (actionId: number) => {
    if (currentId === null || executingId !== null || sending) return
    if (workspaceMismatch) {
      message.warning('该对话属于另一个课表，无法在当前课表下操作')
      return
    }
    setExecutingId(actionId)
    try {
      await aiApi.reject(currentId, actionId)
      await refreshMessages(currentId, true)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    } finally {
      setExecutingId(null)
    }
  }

  const weekInfo = activeSchedule
    ? formatWeekInfo(activeSchedule.periodStartDate, activeSchedule.periodEndDate)
    : null

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      {convPanelOpen && <div className="conv-backdrop" onClick={() => setConvPanelOpen(false)} />}
      <Card
        className={`conv-panel${convPanelOpen ? ' open' : ''}`}
        size="small"
        title="对话记录"
        style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column' }}
        styles={{
          body: {
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1,
            minHeight: 0,
            padding: '8px 12px',
          },
        }}
        extra={
          listMode === 'normal' ? (
            <Space size={2}>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                title="批量编辑"
                onClick={startBatchEdit}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                title="批量删除"
                onClick={startBatchDelete}
              />
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                title="新建对话"
                onClick={newConversation}
              />
            </Space>
          ) : listMode === 'edit' ? (
            <Space size={2}>
              <Button size="small" type="primary" onClick={saveBatchEdit}>
                保存
              </Button>
              <Button size="small" onClick={cancelBatchEdit}>
                取消
              </Button>
            </Space>
          ) : (
            <Space size={2}>
              <Button
                size="small"
                type="primary"
                danger
                disabled={deleteSelected.length === 0}
                onClick={doBatchDelete}
              >
                删除({deleteSelected.length})
              </Button>
              <Button size="small" onClick={cancelBatchDelete}>
                取消
              </Button>
            </Space>
          )
        }
      >
        <List
          size="small"
          dataSource={conversations}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(conv) => {
            const selected = deleteSelected.includes(conv.id)
            const active = listMode === 'normal' && conv.id === currentId
            return (
              <List.Item
                style={{
                  cursor: listMode === 'normal' ? 'pointer' : 'default',
                  background: active || selected ? 'var(--accent)' : undefined,
                  borderRadius: 4,
                  paddingInline: 8,
                }}
                onClick={() => {
                  if (listMode === 'normal') {
                    changeConversation(conv.id)
                    setConvPanelOpen(false)
                  } else if (listMode === 'delete') toggleDeleteSelect(conv.id)
                }}
              >
                <Space size={4} style={{ width: '100%' }}>
                  {listMode === 'delete' && (
                    <Checkbox
                      checked={selected}
                      onChange={() => toggleDeleteSelect(conv.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  {listMode === 'edit' ? (
                    <Input
                      size="small"
                      value={edits[conv.id] ?? ''}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [conv.id]: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: '100%' }}
                    />
                  ) : (
                    <Typography.Text
                      ellipsis
                      style={
                        listMode === 'delete'
                          ? { maxWidth: 140, flex: 1 }
                          : { maxWidth: 180, flex: 1 }
                      }
                    >
                      {conv.title || '新对话'}
                    </Typography.Text>
                  )}
                  {streams[conv.id] && <Spin size="small" />}
                </Space>
              </List.Item>
            )
          }}
        />
        {conversationCursor && <Button block type="text" loading={loadingConversations}
          onClick={loadMoreConversations}>加载更多对话</Button>}
      </Card>

      <Card
        size="small"
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
        styles={{
          body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16 },
        }}
        title={
          <Space wrap={false}>
            <Button
              className="conv-toggle-btn"
              size="small"
              icon={<MenuOutlined />}
              onClick={() => setConvPanelOpen(true)}
            >
              对话
            </Button>
            <span>AI 助手</span>
            {convScheduleName ? (
              <Tag color={workspaceMismatch ? 'red' : 'blue'}>
                {workspaceMismatch ? '⚠ ' : ''}
                {convScheduleName}
              </Tag>
            ) : activeSchedule ? (
              <Tag color="blue">{activeSchedule.name}</Tag>
            ) : (
              <Tag color="orange">未选择课表</Tag>
            )}
            {activeSchedule && !workspaceMismatch && weekInfo && <Tag>{weekInfo}</Tag>}
          </Space>
        }
      >
        {enabled === false && (
          <Alert
            type="warning"
            showIcon
            message="AI 功能未启用"
            description="后端未配置 DEEPSEEK_API_KEY 环境变量，请设置后重启服务。"
            style={{ marginBottom: 12, flexShrink: 0 }}
          />
        )}

        {workspaceMismatch && (
          <Alert
            type="error"
            showIcon
            message="工作空间不一致"
            description={`该对话属于「${
              currentConv?.scheduleId != null
                ? (schedules.find((s) => s.id === currentConv?.scheduleId)?.name ??
                  `课表#${currentConv.scheduleId}`)
                : '某课表'
            }」，与当前课表「${
              activeSchedule?.name ?? '未选择'
            }」不一致，已锁定发送与操作。请切换到对应课表，或新建对话。`}
            style={{ marginBottom: 12, flexShrink: 0 }}
          />
        )}

        <div className="chat-layout">
          <div className="chat-messages" ref={chatScrollRef}>
            {messageCursor && !loadingMessages && <div style={{ textAlign: 'center', paddingBottom: 12 }}>
              <Button size="small" loading={loadingOlder} disabled={sending} onClick={loadOlderMessages}>
                加载更早的消息
              </Button>
            </div>}
            {loadingMessages ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin />
              </div>
            ) : messages.length === 0 && !stream ? (
              <Empty
                description={
                  <div>
                    <span>用一句话管理课表和待办，支持一次做多件事</span>
                    <Space wrap style={{ justifyContent: 'center' }}>
                      {EXAMPLES.map((ex, i) => (
                        <Typography.Text key={i} className="example-chip" type="secondary">
                          {ex}
                        </Typography.Text>
                      ))}
                    </Space>
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 11, marginTop: 4 }}
                    >
                      以上仅为示例，不一定适用于当前课表，请按自己的情况描述。
                    </Typography.Text>
                  </div>
                }
                style={{ paddingTop: 60 }}
              />
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.messageId}
                  className={`chat-row${msg.role === 'user' ? ' chat-row-user' : ''}`}
                >
                  <div>
                    <div
                      className={`chat-bubble chat-bubble-${
                        msg.role === 'user' ? 'user' : 'assistant'
                      }`}
                    >
                      {msg.text}
                    </div>
                    {(msg.actions ?? []).map((action) => (
                      <AiActionCard
                        key={action.actionId}
                        action={action}
                        executing={executingId === action.actionId}
                        scheduleName={schedules.find((s) => s.id === (action.scheduleId ?? currentConv?.scheduleId))?.name}
                        disabled={workspaceMismatch || sending || executingId !== null ||
                          (action.scope === 'COURSE' && (action.scheduleId ?? currentConv?.scheduleId) !== activeScheduleId)}
                        onExecute={() => execute(action.actionId)}
                        onReject={() => reject(action.actionId)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}

            {stream && (
              <>
                <div className="chat-row chat-row-user">
                  <div className="chat-bubble chat-bubble-user">{stream.userText}</div>
                </div>
                <div className="chat-row">
                  <div className="chat-bubble chat-bubble-assistant">
                    {stream.phase === 'thinking' && (
                      <Space size={6}>
                        <Spin size="small" />
                        <Typography.Text type="secondary">思考中…</Typography.Text>
                      </Space>
                    )}
                    {stream.phase !== 'thinking' && (
                      <>
                        {stream.text}
                        {stream.phase === 'planning' && (
                          <div style={{ marginTop: 8 }}>
                            <Space size={6}>
                              <Spin size="small" />
                              <Typography.Text type="secondary">规划操作中…</Typography.Text>
                            </Space>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-bar">
            <Input.TextArea
              value={input}
              maxLength={20000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入自然语言指令，可一次说多件事（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={enabled === false || workspaceMismatch}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  if (!sending) send()
                }
              }}
            />
            {sending ? (
              <Button danger icon={<StopOutlined />} onClick={stopSending}>
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={enabled === false || workspaceMismatch || !input.trim()}
                onClick={send}
              >
                发送
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
