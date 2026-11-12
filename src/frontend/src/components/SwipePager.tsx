import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  NavigationType,
  UNSAFE_LocationContext,
  useLocation,
  useNavigate,
  type Location,
} from 'react-router-dom'
import { classifySwipeStart, routeIndex, shouldCommitSwipe, stepIndex } from '../utils/swipeNavigation'

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

  const neighborLocation = useMemo<Location | null>(() => {
    if (!neighbor) return null
    return { pathname: neighbor.path, search: '', hash: '', state: null, key: `peek-${neighbor.path}` }
  }, [neighbor])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
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
      track.style.transition = ''
      track.style.transform = ''
      track.style.willChange = ''
      track.style.userSelect = ''
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
        const gesture = classifySwipeStart(dx, dy)
        if (gesture !== 'horizontal') {
          if (gesture === 'vertical') state.tracking = false
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
      const commit = shouldCommitSwipe(state.dx, width)

      void (async () => {
        if (commit && target !== null) {
          await animate(track, `translate3d(${direction > 0 ? -width : width}px, 0, 0)`, reduce.matches ? 0 : OUT_MS)
          navigate(routes[target])
          track.style.transition = 'none'
          track.style.transform = 'translate3d(0, 0, 0)'
          setNeighbor(null)
        } else {
          await animate(track, 'translate3d(0, 0, 0)', reduce.matches ? 0 : BACK_MS)
          setNeighbor(null)
        }
        state.dx = 0
        reset()
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

    viewport.addEventListener('touchstart', onStart, { passive: true })
    viewport.addEventListener('touchmove', onMove, { passive: false })
    viewport.addEventListener('touchend', onEnd, { passive: true })
    viewport.addEventListener('touchcancel', onCancel, { passive: true })
    window.addEventListener('click', onClick, true)
    return () => {
      viewport.removeEventListener('touchstart', onStart)
      viewport.removeEventListener('touchmove', onMove)
      viewport.removeEventListener('touchend', onEnd)
      viewport.removeEventListener('touchcancel', onCancel)
      window.removeEventListener('click', onClick, true)
    }
  }, [location.pathname, navigate, routes])

  return (
    <div className="swipe-viewport" ref={viewportRef}>
      <div className="swipe-track" ref={trackRef}>
        <div className="swipe-page">{children}</div>
        {neighborLocation && neighbor ? (
          <div
            className="swipe-page swipe-page-neighbor"
            style={neighbor.side === 'right' ? { left: '100%' } : { right: '100%' }}
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
