import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  NavigationType,
  UNSAFE_LocationContext,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom'
import { routeIndex, stepIndex } from '../utils/swipeNavigation'

const BLOCKED_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="slider"]',
  '.ant-slider',
  '.ant-picker',
  '.ant-picker-dropdown',
  '.ant-select',
  '.ant-modal-wrap',
  '.ant-drawer',
  '.ant-popover',
  '.ant-dropdown',
  '.mobile-nav',
  '.app-topbar',
  '.app-sidebar',
  '.sidebar-backdrop',
  '.conv-panel',
  '[data-swipe-ignore]',
].join(', ')

const OUT_MS = 220
const BACK_MS = 200
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** 拖动时两页之间的可见缝隙；提交动画也按 页面宽度 + 缝隙 平移，落位后不会跳。 */
const GAP_PX = 12

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(BLOCKED_SELECTOR)) return true
  let node: Element | null = target
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const overflowX = getComputedStyle(node).overflowX
      if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 8)
        return true
    }
    node = node.parentElement
  }
  return false
}

function animate(node: HTMLElement, transform: string, duration: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      node.removeEventListener('transitionend', onEnd)
      resolve()
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === 'transform') done()
    }
    node.style.transition = duration > 0 ? `transform ${duration}ms ${EASING}` : 'none'
    node.style.transform = transform
    node.addEventListener('transitionend', onEnd)
    window.setTimeout(done, duration + 80)
  })
}

function resetTrack(track: HTMLElement) {
  track.style.transition = ''
  track.style.transform = ''
  track.style.willChange = ''
  track.style.userSelect = ''
}

interface Props {
  routes: readonly string[]
  renderPage: (location: Location) => ReactNode
  children: ReactNode
}

/**
 * 手机端左右滑动切页：拖动时同时露出相邻页面的真实路由内容，
 * 松手后整条轨道滑到目标页；短距离拖动回弹，首末页带阻尼。
 * 原生 touchmove 监听（非 passive）才能在横向拖动时阻止页面滚动。
 */
export default function SwipePager({ routes, renderPage, children }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [neighbor, setNeighbor] = useState<{ path: string; side: 'left' | 'right' } | null>(null)
  const neighborRef = useRef(neighbor)
  neighborRef.current = neighbor
  /** 提交翻页后等待路由落地的目标路径；路由落地前不要把轨道归零，否则会闪回旧页。 */
  const pendingResetRef = useRef<string | null>(null)
  const pendingTimerRef = useRef<number | null>(null)

  const neighborLocation = useMemo<Location | null>(() => {
    if (!neighbor) return null
    return { pathname: neighbor.path, search: '', hash: '', state: null, key: `peek-${neighbor.path}` }
  }, [neighbor])

  /**
   * 轨道归零必须发生在新路由的内容已经挂载之后（useLayoutEffect），
   * 否则 transform 先归零、children 还是旧页，会看到上一页闪一下。
   */
  const finishCommit = useCallback(() => {
    const track = trackRef.current
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    pendingResetRef.current = null
    if (track) {
      track.style.transition = 'none'
      track.style.transform = 'translate3d(0, 0, 0)'
    }
    setNeighbor(null)
    window.requestAnimationFrame(() => {
      if (trackRef.current) resetTrack(trackRef.current)
    })
  }, [])

  useLayoutEffect(() => {
    if (pendingResetRef.current && pendingResetRef.current === location.pathname) finishCommit()
  }, [location.pathname, finishCommit])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    // 手势挂在滚动容器上，页面下半的空白区域也能翻页。
    const surface = (viewport.closest('.app-content') as HTMLElement | null) ?? viewport
    const media = window.matchMedia('(max-width: 767px)')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const state = {
      tracking: false,
      dragging: false,
      blocked: false,
      startX: 0,
      startY: 0,
      dx: 0,
      index: routeIndex(location.pathname, routes),
    }
    let suppressClick = false

    const reset = () => {
      resetTrack(track)
    }

    const onStart = (event: TouchEvent) => {
      state.tracking = false
      if (!media.matches || event.touches.length !== 1 || state.index < 0) return
      const touch = event.touches[0]
      state.tracking = true
      state.dragging = false
      state.blocked = isBlockedTarget(event.target)
      state.startX = touch.clientX
      state.startY = touch.clientY
      state.dx = 0
    }

    const onMove = (event: TouchEvent) => {
      if (!state.tracking || state.blocked) return
      if (event.touches.length !== 1) {
        state.tracking = false
        setNeighbor(null)
        reset()
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      if (!state.dragging) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          if (Math.abs(dy) > 12) state.tracking = false
          return
        }
        state.dragging = true
        track.style.transition = 'none'
        track.style.willChange = 'transform'
        track.style.userSelect = 'none'
      }
      event.preventDefault()
      const direction = dx < 0 ? 1 : -1
      const target = stepIndex(state.index, routes.length, direction)
      if (target === null) {
        state.dx = dx * 0.28
      } else {
        state.dx = dx
        const side = direction > 0 ? 'right' : 'left'
        const current = neighborRef.current
        if (!current || current.path !== routes[target] || current.side !== side)
          setNeighbor({ path: routes[target], side })
      }
      track.style.transform = `translate3d(${state.dx}px, 0, 0)`
    }

    const onEnd = () => {
      if (!state.tracking) return
      state.tracking = false
      if (!state.dragging) return
      state.dragging = false
      suppressClick = true
      window.setTimeout(() => {
        suppressClick = false
      }, 80)

      const direction = state.dx < 0 ? 1 : -1
      const target = stepIndex(state.index, routes.length, direction)
      const width = track.clientWidth || window.innerWidth
      const commit = target !== null && Math.abs(state.dx) > Math.min(72, width * 0.18)
      const distance = width + GAP_PX
      state.dx = 0

      void (async () => {
        if (commit && target !== null) {
          await animate(
            track,
            `translate3d(${direction > 0 ? -distance : distance}px, 0, 0)`,
            reduce.matches ? 0 : OUT_MS,
          )
          pendingResetRef.current = routes[target]
          // 断言兜底：路由因外部原因没有落地时，也不能把轨道永远停在偏移位置。
          pendingTimerRef.current = window.setTimeout(() => {
            if (pendingResetRef.current === routes[target]) finishCommit()
          }, 600)
          navigate(routes[target])
        } else {
          await animate(track, 'translate3d(0, 0, 0)', reduce.matches ? 0 : BACK_MS)
          setNeighbor(null)
          reset()
        }
      })()
    }

    const onCancel = () => {
      state.tracking = false
      state.dragging = false
      setNeighbor(null)
      reset()
    }

    const onClick = (event: MouseEvent) => {
      if (!suppressClick) return
      event.preventDefault()
      event.stopPropagation()
      suppressClick = false
    }

    surface.addEventListener('touchstart', onStart, { passive: true })
    surface.addEventListener('touchmove', onMove, { passive: false })
    surface.addEventListener('touchend', onEnd, { passive: true })
    surface.addEventListener('touchcancel', onCancel, { passive: true })
    window.addEventListener('click', onClick, true)
    return () => {
      surface.removeEventListener('touchstart', onStart)
      surface.removeEventListener('touchmove', onMove)
      surface.removeEventListener('touchend', onEnd)
      surface.removeEventListener('touchcancel', onCancel)
      window.removeEventListener('click', onClick, true)
    }
  }, [location.pathname, navigate, routes, finishCommit])

  useEffect(
    () => () => {
      if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current)
    },
    [],
  )

  return (
    <div className="swipe-viewport" ref={viewportRef}>
      <div
        className="swipe-track"
        ref={trackRef}
        style={{ '--swipe-gap': `${GAP_PX}px` } as CSSProperties}
      >
        <div className="swipe-page">{children}</div>
        {neighborLocation && neighbor ? (
          <div
            className="swipe-page swipe-page-neighbor"
            data-side={neighbor.side}
            aria-hidden="true"
          >
            <UNSAFE_LocationContext.Provider
              value={{ location: neighborLocation, navigationType: NavigationType.Pop }}
            >
              {renderPage(neighborLocation)}
            </UNSAFE_LocationContext.Provider>
          </div>
        ) : null}
      </div>
    </div>
  )
}
