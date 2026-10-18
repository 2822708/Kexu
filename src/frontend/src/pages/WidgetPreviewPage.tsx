import { useCallback, useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'
import { courseColor } from '../utils/color'
import { BASE_URL, getApiKey } from '../api/client'

type Schedule = { id: number; name: string }

type CourseItem = {
  name?: string
  time?: string
  location?: string
  teacher?: string
  period?: string
  status?: string
  date?: string
  week?: number
  dow?: string
  sortKey?: number
}
type TodoItem = { title?: string; ddlText?: string; ddlRemain?: string; overdue?: boolean }
type ExamItem = {
  name?: string
  time?: string
  location?: string
  date?: string
  week?: number
  dow?: string
  status?: string
  sortKey?: number
}
type Item = {
  kind: 'course' | 'exam'
  sortKey: number
  name?: string
  time?: string
  location?: string
  teacher?: string
  period?: string
  status?: string
  date?: string
  week?: number
  dow?: string
}

type WidgetData = {
  title?: string
  updatedAt?: string
  week?: string
  today?: string
  todayCourses?: CourseItem[]
  todayRemaining?: number
  todos?: TodoItem[]
  todoSummary?: string
  exams?: ExamItem[]
}

const REFRESH_MS = 60 * 1000

function parseQuery(): { key?: string; scheduleId?: number } {
  const params = new URLSearchParams(window.location.search)
  // Key 优先从 URL fragment（#key=...）读取：fragment 不会随请求发往服务端，
  // 也不进 Referer，比 query 更安全；query 形式继续兼容旧的小组件地址。
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const key = (hash.get('key') ?? params.get('key'))?.trim() || undefined
  const sidRaw = hash.get('scheduleId') ?? params.get('scheduleId')
  const scheduleId = sidRaw ? Number(sidRaw) : undefined
  return { key, scheduleId: Number.isFinite(scheduleId) ? scheduleId : undefined }
}

export default function WidgetPreviewPage() {
  const [{ key, scheduleId }, setQuery] = useState(parseQuery)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [data, setData] = useState<WidgetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<number>()

  // 不再回落到任何内置 Key：固定 Key 一旦写进前端产物就等于公开凭据。
  // 没有 Key 时明确报错，而不是拿一个演示账号去试探。
  const apiKey = key || getApiKey() || ''

  // 拉取该 key 下的课表列表，供选择
  const loadSchedules = useCallback(async (k: string) => {
    try {
      const res = await fetch(`${BASE_URL}/schedules`, {
        headers: { 'X-API-Key': k },
      })
      const payload = await res.json()
      if (payload.code === 200) setSchedules(payload.data ?? [])
    } catch {
      /* 忽略，不影响主流程 */
    }
  }, [])

  const load = useCallback(async (k: string, sid?: number) => {
    if (!k) {
      setError('缺少 API Key：请在小组件地址里带上 #key=<你的 Key>')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Key 走请求头，不再放进 URL 路径
      const res = await fetch(`${BASE_URL}/widget/overview${sid ? `?scheduleId=${sid}` : ''}`, {
        headers: { 'X-API-Key': k },
      })
      const payload = await res.json()
      if (payload.code !== 200) throw new Error(payload.message || '请求失败')
      setData(payload.data)
    } catch (e) {
      const msg = (e as Error).message || '未知错误'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSchedules(apiKey)
  }, [apiKey, loadSchedules])

  useEffect(() => {
    load(apiKey, scheduleId)
    timer.current = window.setInterval(() => load(apiKey, scheduleId), REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(apiKey, scheduleId)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [apiKey, scheduleId, load])

  // 未指定课表时，默认取第一个
  useEffect(() => {
    if (scheduleId === undefined && schedules.length > 0) {
      setQuery((prev) => ({ ...prev, scheduleId: schedules[0].id }))
    }
  }, [scheduleId, schedules])

  const courses = data?.todayCourses ?? []
  const exams = (data?.exams ?? []).slice(0, 2)
  const allItems: Item[] = [
    ...courses.map((c) => ({ ...c, kind: 'course' as const, sortKey: c.sortKey ?? 0 })),
    ...exams.map((e) => ({ ...e, kind: 'exam' as const, sortKey: e.sortKey ?? 0 })),
  ].sort((a, b) => a.sortKey - b.sortKey)

  // 全部渲染，靠容器 overflow:hidden 按可视高度响应式裁切
  const visibleItems = allItems.slice(0, 6)
  const todos = data?.todos ?? []

  return (
    <div className="widget-page b-widget">
      <style>{`
        /* 展示台：柔和地面 + 白色圆角舞台（--b-sh2 + 18px 圆角） */
        .b-widget.widget-page {
          background: var(--bg-main);
          color: var(--b-ink);
          font-family: var(--b-font);
          padding: 18px;
        }
        .b-widget .widget-card-loading,
        .b-widget .widget-card-error {
          color: var(--b-ink-soft);
          font-family: var(--b-font);
        }
        .b-widget .widget-card-error { color: var(--b-red-ink); font-weight: 800; }
        .b-widget-stage {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          border-radius: var(--b-radius);
          box-shadow: var(--b-sh2);
          padding: 16px 20px;
          overflow: hidden;
        }
        .b-widget .widget-head {
          align-items: center;
          border-bottom: 1px solid var(--b-line);
          padding: 2px 0 10px;
        }
        .b-widget .widget-title {
          color: var(--b-ink);
          font-weight: 900;
          font-size: 17px;
          letter-spacing: 0.5px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .b-widget .widget-title::before {
          content: '';
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: var(--b-green);
          box-shadow: var(--b-sh1);
          flex: none;
        }
        .b-widget .widget-meta { color: var(--b-ink-soft); }
        .b-widget .widget-body { padding-top: 12px; gap: 16px; }
        .b-widget .widget-col-divider { background: var(--b-line); }
        .b-widget .widget-col-title {
          color: var(--b-ink);
          font-weight: 900;
          font-size: 12px;
          letter-spacing: 0.5px;
          align-items: center;
          gap: 8px;
          border-bottom: none;
          padding-bottom: 0;
          margin-bottom: 8px;
        }
        .b-widget .widget-col-title > span:first-child {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .b-widget .widget-col-title > span:first-child::before {
          content: '';
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--b-green);
          flex: none;
        }
        .b-widget .widget-col.todos .widget-col-title > span:first-child::before {
          background: var(--b-blue);
        }
        .b-widget .widget-col-count {
          color: var(--b-ink-faint);
          font-size: 10.5px;
          font-weight: 800;
          background: var(--b-bg-soft);
          border-radius: 99px;
          padding: 2px 8px;
        }
        .b-widget .widget-course-list { gap: 8px; }
        .b-widget .widget-todo-list { gap: 6px; }
        .b-widget .widget-course-card {
          border: 1px solid var(--b-line);
          border-left: 3px solid;
          border-radius: var(--b-radius-sm);
          padding: 5px 8px;
          box-shadow: var(--b-sh1);
        }
        .b-widget .widget-course-card-name { font-weight: 800; }
        .b-widget .widget-course-card-status { font-size: 9px; font-weight: 800; opacity: 1; }
        .b-widget .widget-course-card-status[data-status='进行中'] { color: var(--b-green-ink); }
        .b-widget .widget-course-card-status[data-status='已结束'] { color: var(--b-ink-faint); }
        .b-widget .widget-course-card-status[data-status^='还有'] { color: var(--b-purple-ink); }
        .b-widget .widget-course-card-status[data-status='明天'] { color: var(--b-yellow-ink); }
        .b-widget .widget-course-card-status[data-status='后天'] { color: var(--b-yellow-ink); }
        .b-widget .widget-course-card-status[data-status='非最近'] { color: var(--b-ink-faint); }
        .b-widget .widget-exam-card {
          border: 1px solid var(--b-line);
          border-left: 3px solid var(--b-red);
          border-radius: var(--b-radius-sm);
          background: var(--b-red-soft);
          padding: 4px 8px;
          box-shadow: var(--b-sh1);
        }
        .b-widget .widget-exam-card-tag {
          color: var(--b-red-ink);
          border: 1px solid var(--b-red);
          border-radius: 99px;
          padding: 0 6px;
          font-weight: 900;
          background: var(--bg-card);
        }
        .b-widget .widget-todo-row {
          background: var(--b-bg-soft);
          border-radius: var(--b-radius-sm);
          padding: 5px 10px;
        }
        .b-widget .widget-todo-dot { color: var(--b-ink-faint); }
        .b-widget .widget-todo-dot[data-overdue='true'] { color: var(--b-red); }
        .b-widget .widget-todo-title { color: var(--b-ink); font-weight: 700; }
        .b-widget .widget-todo-title[data-overdue='true'] { color: var(--b-red-ink); }
        .b-widget .widget-todo-ddl { color: var(--b-ink-faint); }
        .b-widget .widget-todo-remain { color: var(--b-green-ink); font-weight: 800; }
        .b-widget .widget-todo-remain[data-overdue='true'] { color: var(--b-red-ink); }
        .b-widget .widget-empty { color: var(--b-ink-faint); }
      `}</style>
      <div className="b-widget-stage">
        {loading && !data ? (
          <div className="widget-card-loading">
            <Spin />
          </div>
        ) : error && !data ? (
          <div className="widget-card-error">加载失败：{error}</div>
        ) : (
          <>
            <div className="widget-head">
              <span className="widget-title">{data?.title || '课程表'}</span>
              <span className="widget-meta">
                {data?.week ? `${data.week}·` : ''}
                {data?.today || ''}
                {data?.updatedAt ? `·更新 ${data.updatedAt}` : ''}
              </span>
            </div>

            <div className="widget-body">
              <div className="widget-col timetable">
                <div className="widget-col-title">
                  <span>课程和考试</span>
                  <span className="widget-col-count">今日剩余{data?.todayRemaining ?? 0}项</span>
                </div>
                <div className="widget-course-list">
                  {visibleItems.length ? (
                    visibleItems.map((c, i) => {
                      if (c.kind === 'exam') {
                        return (
                          <div className="widget-exam-card" key={`exam-${i}`}>
                            <div className="widget-exam-card-tag">考</div>
                            <div className="widget-exam-info">
                              <div className="widget-exam-card-head-row">
                                <div className="widget-course-card-name">{c.name}</div>
                                <span className="widget-course-card-status" data-status={c.status}>
                                  {c.status}
                                </span>
                              </div>
                              <div className="widget-course-card-meta">
                                {c.date}·第{c.week}周·{c.dow}
                              </div>
                            </div>
                          </div>
                        )
                      }
                      const color = courseColor(c.name || '')
                      return (
                        <div
                          className="widget-course-card"
                          key={`course-${i}`}
                          style={{
                            background: color.bg,
                            borderLeftColor: color.border,
                            color: color.text,
                          }}
                        >
                          <div className="widget-course-card-head">
                            <span className="widget-course-card-name">{c.name}</span>
                            <span className="widget-course-card-status" data-status={c.status}>
                              {c.status}
                            </span>
                          </div>
                          <div className="widget-course-card-meta">
                            {c.date}·{c.dow}·第{c.week}周{c.location ? `·${c.location}` : ''}
                          </div>
                          <div className="widget-course-card-meta">
                            {c.period ? `${c.period}·` : ''}
                            {c.time}
                            {c.teacher ? `·${c.teacher}` : ''}
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="widget-empty">今天没有课</div>
                  )}
                </div>
              </div>

              <div className="widget-col-divider" />

              <div className="widget-col todos">
                <div className="widget-col-title">
                  <span>待办</span>
                  <span className="widget-col-count">{data?.todoSummary || '暂无'}</span>
                </div>
                <div className="widget-todo-list">
                  {todos.length ? (
                    todos.map((t, i) => (
                      <div className="widget-todo-row" key={i}>
                        <span className="widget-todo-dot" data-overdue={!!t.overdue}>
                          {t.overdue ? '●' : '○'}
                        </span>
                        <span className="widget-todo-title" data-overdue={!!t.overdue}>
                          {t.title}
                        </span>
                        <span className="widget-todo-meta">
                          <span className="widget-todo-ddl">{t.ddlText}</span>
                          <span className="widget-todo-remain" data-overdue={!!t.overdue}>
                            {t.ddlRemain || '-'}
                          </span>
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="widget-empty">暂无待办</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
