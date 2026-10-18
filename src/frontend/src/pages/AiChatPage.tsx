import { LOCAL_MODE } from '../local/mode'
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
import { DeleteOutlined, EditOutlined, MenuOutlined, PlusOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import AiActionCard from '../components/AiActionCard'
import AiChatComposer from '../components/AiChatComposer'
import { aiApi } from '../api'
import { useApp } from '../store/AppContext'
import type { AiConversation, AiMessage } from '../types'
import { formatWeekInfo } from '../utils/schedule'
import { subscribeAiSettings } from '../local/ai/settings'
import { localAiStream } from '../local/ai'
import { readLocalState, subscribeLocalChanges } from '../local/db'
import { currentImportConversation, localChatView } from '../local/ai/uiState'

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

function conversationIdentity(conversation: AiConversation | undefined): string | null {
  return conversation && 'publicId' in conversation && typeof conversation.publicId === 'string'
    ? conversation.publicId
    : null
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
  const conversationCountRef = useRef(30)
  const selectedPublicIdRef = useRef<string | null>(null)
  const importIntentRef = useRef<{ conversationId: number; kind: 'IMPORT_EVENTS' } | null>(null)

  const stream = currentId !== null ? streams[currentId] : undefined
  const sending = stream !== undefined || creatingConversation

  const changeConversation = useCallback(
    (id: number | null, abort = true, publicId: string | null = null) => {
      if (id !== currentIdRef.current) {
        if (importIntentRef.current) setInput('')
        importIntentRef.current = null
        if (abort) activeAbortRef.current?.abort()
        messageRequestRef.current++
        messagesRef.current = []
        setMessages([])
        setMessageCursor(null)
        setLoadingOlder(false)
        setLoadingMessages(id !== null)
        currentIdRef.current = id
        selectedPublicIdRef.current = publicId
        setCurrentId(id)
      }
    },
    [],
  )

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
    currentConv !== null &&
    (LOCAL_MODE
      ? currentConv.scheduleId !== activeScheduleId
      : currentConv.scheduleId != null && currentConv.scheduleId !== activeScheduleId)
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
    let active = true
    let version = 0
    const refresh = () => {
      const request = ++version
      void aiApi
        .status()
        .then((status) => {
          if (active && request === version) setEnabled(status.enabled)
        })
        .catch(() => {
          if (active && request === version) setEnabled(false)
        })
    }
    const changed = () => {
      activeAbortRef.current?.abort()
      setEnabled(null)
      refresh()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    const unsubscribeSettings = LOCAL_MODE ? subscribeAiSettings(changed) : () => {}
    if (LOCAL_MODE) {
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', visible)
    }
    return () => {
      active = false
      unsubscribeSettings()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  const loadConversations = useCallback(async () => {
    const version = ++conversationRequestRef.current
    const page = await aiApi.pageConversations()
    if (version === conversationRequestRef.current) {
      setConversations(page.items)
      setConversationCursor(page.nextCursor)
      conversationCountRef.current = Math.max(30, page.items.length)
    }
    return version === conversationRequestRef.current ? page.items : []
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
        const next = [...old, ...page.items.filter((item) => !seen.has(item.id))]
        conversationCountRef.current = next.length
        return next
      })
      setConversationCursor(page.nextCursor)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载对话失败')
    } finally {
      setLoadingConversations(false)
    }
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

  useEffect(() => {
    if (!LOCAL_MODE) return
    let disposed = false
    let version = 0
    let initial = true
    const refresh = async () => {
      const request = ++version
      try {
        const state = await readLocalState()
        if (disposed || request !== version) return
        const id = currentIdRef.current
        const view = localChatView(
          state,
          id,
          selectedPublicIdRef.current,
          conversationCountRef.current,
        )
        setConversations(view.items)
        setConversationCursor(view.nextCursor)
        conversationCountRef.current = Math.max(30, view.items.length)
        conversationRequestRef.current++
        if (initial && id === null && view.items.length > 0) {
          initial = false
          changeConversation(view.items[0].id, true, conversationIdentity(view.items[0]))
          return
        }
        initial = false
        if (view.selectionMissing) {
          activeAbortRef.current?.abort()
          setStreams({})
          setInput('')
          setListMode('normal')
          setEdits({})
          setDeleteSelected([])
          changeConversation(null)
          message.info('本地对话已被删除或恢复替换，已关闭旧会话；请新建对话继续。')
          return
        }
        selectedPublicIdRef.current = view.selectedPublicId
        if (id !== null && !activeAbortRef.current) await refreshMessages(id, true)
      } catch {
        /* Local storage errors are surfaced by the app provider; retain the visible draft. */
      }
    }
    const unsubscribe = subscribeLocalChanges(() => {
      void refresh()
    })
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', visible)
    void refresh()
    return () => {
      disposed = true
      version++
      unsubscribe()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [changeConversation, refreshMessages])

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
      const next = [
        ...page.items.filter((item) => !existing.has(item.messageId)),
        ...messagesRef.current,
      ]
      messagesRef.current = next
      setMessages(next)
      setMessageCursor(page.nextCursor)
      requestAnimationFrame(() => {
        if (chatScrollRef.current && currentIdRef.current === id) {
          chatScrollRef.current.scrollTop += chatScrollRef.current.scrollHeight - previousHeight
        }
      })
    } catch (e) {
      if (currentIdRef.current === id)
        message.error(e instanceof Error ? e.message : '加载历史失败')
    } finally {
      if (currentIdRef.current === id) setLoadingOlder(false)
    }
  }

  useEffect(() => {
    loadConversations()
      .then((list) => {
        if (list.length > 0 && currentIdRef.current === null)
          changeConversation(list[0].id, true, conversationIdentity(list[0]))
      })
      .catch((e: Error) => message.error(e.message))
  }, [loadConversations, changeConversation])

  useEffect(() => {
    const state = location.state as {
      quickImport?: {
        conversationId: number
        scheduleId: number | null
        conversationPublicId?: string
        prompt: string
        intent?: 'IMPORT_EVENTS'
      }
    } | null
    const draft = state?.quickImport
    if (!draft) return
    if (draft.scheduleId !== activeScheduleId) {
      navigate(location.pathname, { replace: true, state: null })
      message.warning('导入材料绑定的课表已变化，请切回对应课表后重试。')
      return
    }
    if (!Number.isSafeInteger(draft.conversationId) || !draft.prompt?.trim()) {
      navigate(location.pathname, { replace: true, state: null })
      message.error('导入内容无效，请重新导入。')
      return
    }
    let active = true
    const apply = async () => {
      const localState = LOCAL_MODE ? await readLocalState() : null
      if (localState && !currentImportConversation(localState, draft)) {
        if (active) {
          navigate(location.pathname, { replace: true, state: null })
          message.warning('导入草稿的本地会话已被删除或恢复替换，请重新转交材料。')
        }
        return
      }
      if (!active) return
      changeConversation(
        draft.conversationId,
        true,
        conversationIdentity(
          localState?.conversations.find((row) => row.id === draft.conversationId),
        ),
      )
      setInput(draft.prompt)
      importIntentRef.current =
        draft.intent === 'IMPORT_EVENTS'
          ? { conversationId: draft.conversationId, kind: 'IMPORT_EVENTS' }
          : null
      navigate(location.pathname, { replace: true, state: null })
    }
    void apply().catch(() => {
      if (active) {
        navigate(location.pathname, { replace: true, state: null })
        message.error('无法打开本地导入草稿，材料未发送')
      }
    })
    return () => {
      active = false
    }
  }, [location.state, location.pathname, navigate, activeScheduleId, changeConversation])

  useEffect(() => {
    if (currentId === null) {
      setLoadingMessages(false)
      return
    }
    setLoadingMessages(true)
    refreshMessages(currentId)
      .catch((e: Error) => {
        if (currentIdRef.current === currentId) message.error(e.message)
      })
      .finally(() => {
        if (currentIdRef.current === currentId) setLoadingMessages(false)
      })
  }, [currentId, refreshMessages])

  // 课表/待办变化时重新拉取消息，让失效提案立即显示
  const dataVersion = JSON.stringify([courses, exams, todos, recurringTodos])
  const previousDataVersionRef = useRef(dataVersion)
  useEffect(() => {
    if (previousDataVersionRef.current === dataVersion || currentId === null || sending) return
    previousDataVersionRef.current = dataVersion
    refreshMessages(currentId, true).catch(() => undefined)
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
      changeConversation(conv.id, true, conversationIdentity(conv))
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
      if (currentIdRef.current === id)
        changeConversation(list.length > 0 ? list[0].id : null, true, conversationIdentity(list[0]))
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

  const send = async (draft: string = input) => {
    const content = draft.trim()
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
        changeConversation(conv.id, false, conversationIdentity(conv))
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
      if (controller.signal.aborted && activeAbortRef.current === controller)
        activeAbortRef.current = null
    }

    if (controller.signal.aborted) return
    const cid = convId
    setStreams((prev) => ({
      ...prev,
      [cid]: { phase: 'thinking', text: '', userText: content },
    }))

    try {
      const sendStream = LOCAL_MODE ? localAiStream : aiApi.sendMessageStream
      await sendStream(
        cid,
        content,
        activeScheduleId,
        {
          onThinking: () => patchStream(cid, { phase: 'thinking' }),
          onText: (delta) =>
            setStreams((prev) => {
              const cur = prev[cid]
              if (!cur) return prev
              return { ...prev, [cid]: { ...cur, phase: 'text', text: cur.text + delta } }
            }),
          onPlanning: () => patchStream(cid, { phase: 'planning' }),
        },
        controller.signal,
        LOCAL_MODE && importIntentRef.current?.conversationId === cid
          ? importIntentRef.current.kind
          : undefined,
      )
      if (importIntentRef.current?.conversationId === cid) importIntentRef.current = null
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
      if (!controller.signal.aborted && currentIdRef.current === cid)
        setInput((draft) => draft || content)
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
    <div className="ai-chat-page" style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
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
                    changeConversation(conv.id, true, conversationIdentity(conv))
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
        {conversationCursor && (
          <Button block type="text" loading={loadingConversations} onClick={loadMoreConversations}>
            加载更多对话
          </Button>
        )}
      </Card>

      <Card
        className="ai-chat-main"
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
            description={
              LOCAL_MODE
                ? '请在设置中连接你选择的 AI 服务。消息、选定课表与本机待办的必要上下文仅在主动发送时直达该服务，课表、考试和待办可离线使用。'
                : '请联系服务管理员启用 AI。课表、考试和待办仍可正常使用。'
            }
            style={{ marginBottom: 12, flexShrink: 0 }}
          />
        )}

        {LOCAL_MODE && enabled === true && (
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 8, flexShrink: 0, fontSize: 12 }}
          >
            会话保存在本机；点击发送时才会把消息、当前课表与待办的必要上下文发给你设置的AI服务。每张修改卡仍需单独确认。
          </Typography.Paragraph>
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
            {messageCursor && !loadingMessages && (
              <div style={{ textAlign: 'center', paddingBottom: 12 }}>
                <Button
                  size="small"
                  loading={loadingOlder}
                  disabled={sending}
                  onClick={loadOlderMessages}
                >
                  加载更早的消息
                </Button>
              </div>
            )}
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
                        scheduleName={
                          schedules.find(
                            (s) => s.id === (action.scheduleId ?? currentConv?.scheduleId),
                          )?.name
                        }
                        disabled={
                          workspaceMismatch ||
                          sending ||
                          executingId !== null ||
                          (action.scope === 'COURSE' &&
                            (action.scheduleId ?? currentConv?.scheduleId) !== activeScheduleId)
                        }
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

          <AiChatComposer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stopSending}
            sending={sending}
            disabled={workspaceMismatch}
            sendDisabled={enabled !== true}
            scopeKey={`${currentId ?? 'new'}:${activeScheduleId ?? 'none'}`}
          />
        </div>
      </Card>
    </div>
  )
}
