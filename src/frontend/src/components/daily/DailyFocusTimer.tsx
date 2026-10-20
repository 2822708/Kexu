import { readCompatiblePreference } from '../../../../shared/brandCompatibility.mjs'
import { useEffect, useRef, useState } from 'react'
import { Button, Select } from 'antd'
import { PauseOutlined, PlayCircleOutlined } from '@ant-design/icons'

type Target = { key: string; title: string }
type Timer = { target: Target; remaining: number; endsAt: number | null; phase: 'focus' | 'break' }
const TIMER_KEY = 'kexu.daily.timer.v2'
const label = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

function readTimer(generation: string): Timer | null {
  try {
    const saved = JSON.parse(readCompatiblePreference(localStorage, TIMER_KEY) ?? 'null')
    if (
      saved?.generation === generation &&
      saved.timer &&
      typeof saved.timer.target?.key === 'string' &&
      typeof saved.timer.target?.title === 'string' &&
      Number.isFinite(saved.timer.remaining) &&
      saved.timer.remaining >= 0 &&
      saved.timer.remaining <= 2700 &&
      (saved.timer.endsAt === null || Number.isFinite(saved.timer.endsAt)) &&
      ['focus', 'break'].includes(saved.timer.phase)
    )
      return saved.timer
  } catch {
    /* A damaged preference must not affect business data. */
  }
  return null
}

export default function DailyFocusTimer({
  generation,
  targets,
  onStart,
}: {
  generation: string
  targets: Target[]
  onStart: (target: Target) => Promise<void>
}) {
  const [minutes, setMinutes] = useState(25)
  const [selected, setSelected] = useState<string>()
  const [timer, setTimer] = useState<Timer | null>(() => readTimer(generation))
  const [now, setNow] = useState(Date.now)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState('')
  const currentGeneration = useRef(generation)
  currentGeneration.current = generation
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify({ generation, timer }))
    } catch {
      /* In-memory timer remains available. */
    }
  }, [generation, timer])
  const remaining = timer?.endsAt
    ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
    : (timer?.remaining ?? minutes * 60)
  useEffect(() => {
    if (timer?.endsAt && remaining === 0) {
      setTimer((current) => (current ? { ...current, endsAt: null, remaining: 0 } : current))
      setStatus(
        timer.phase === 'focus'
          ? '本轮计时结束，任务仍由你确认完成。'
          : '休息结束，可以开始下一轮。',
      )
    }
  }, [timer, remaining])
  const start = async () => {
    const target = targets.find((item) => item.key === selected)
    if (!target || starting) return
    const expected = generation
    setStarting(true)
    try {
      await onStart(target)
      if (expected !== currentGeneration.current) return
      setTimer({
        target,
        phase: 'focus',
        remaining: minutes * 60,
        endsAt: Date.now() + minutes * 60_000,
      })
      setStatus('已开始计时')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法开始计时')
    } finally {
      setStarting(false)
    }
  }
  const resume = async () => {
    if (!timer || starting) return
    const expected = generation
    setStarting(true)
    try {
      if (timer.phase === 'focus') await onStart(timer.target)
      if (expected !== currentGeneration.current) return
      setTimer({ ...timer, endsAt: Date.now() + remaining * 1000 })
      setStatus('已继续计时')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法继续计时')
    } finally {
      setStarting(false)
    }
  }
  return (
    <div className="daily-focus-tool">
      <div className="daily-focus-options">
        <Select
          aria-label="选择专注任务"
          placeholder="选择待做任务"
          value={selected}
          onChange={setSelected}
          options={targets.map((target) => ({ value: target.key, label: target.title }))}
        />
        <Select
          aria-label="专注时长"
          value={minutes}
          onChange={setMinutes}
          disabled={Boolean(timer?.endsAt)}
          options={[15, 25, 45].map((value) => ({ value, label: `${value} 分钟` }))}
        />
      </div>
      <div className="daily-clock" role="timer" aria-label="剩余时间">
        {label(remaining)}
      </div>
      {timer && (
        <p className="daily-timer-target">
          {timer.target.title} · {timer.phase === 'break' ? '休息' : '专注'}
        </p>
      )}
      <div className="daily-timer-actions">
        {timer?.endsAt ? (
          <Button
            icon={<PauseOutlined />}
            onClick={() => setTimer({ ...timer, remaining, endsAt: null })}
          >
            暂停
          </Button>
        ) : timer && remaining > 0 ? (
          <Button icon={<PlayCircleOutlined />} onClick={() => void resume()} loading={starting}>
            继续
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => void start()}
            loading={starting}
            disabled={!selected || !targets.some((target) => target.key === selected)}
          >
            开始专注
          </Button>
        )}
        {timer && !timer.endsAt && remaining === 0 && (
          <Button
            onClick={() =>
              setTimer({ ...timer, phase: 'break', remaining: 300, endsAt: Date.now() + 300_000 })
            }
          >
            休息5分钟
          </Button>
        )}
        {timer && (
          <Button
            onClick={() => {
              setTimer(null)
              setStatus('已结束计时，任务状态保持原样。')
            }}
          >
            结束计时
          </Button>
        )}
      </div>
      <p className="daily-muted">计时结束不会自动完成任务，也不计入回顾的专注时长。</p>
      <p role="status" className="daily-muted">
        {status}
      </p>
    </div>
  )
}
