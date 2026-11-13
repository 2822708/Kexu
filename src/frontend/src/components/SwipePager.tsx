import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

function animate(node: HTMLElement, transform: string, duration: number, onComplete: () => void) {
  const cancel = () => {
    window.clearTimeout(timer)
    node.removeEventListener('transitionend', onEnd)
  }
  const finish = () => {
    cancel()
    onComplete()
  }
  const onEnd = (event: TransitionEvent) => {
    if (event.target === node && event.propertyName === 'transform') finish()
  }
  // 减少动态效果或浏览器未触发 transitionend 时仍会完成动画。
  const timer = window.setTimeout(finish, duration > 0 ? duration + 80 : 0)
  node.style.transition = duration > 0 ? `transform ${duration}ms ${EASING}` : 'none'
  node.style.transform = transform
  node.addEventListener('transitionend', onEnd)
  return cancel
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

  const neighborLocation = useMemo<Location | null>(() => {
    if (!neighbor) return null
    return { pathname: neighbor.path, search: '', hash: '', state: null, key: `peek-${neighbor.path}` }
  }, [neighbor])

  // 路由提交时在绘制前重置轨道，取消旧页面的手势、动画和导航回调。
  useLayoutEffect(() => {
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
      sourceUrl: '',
      index: routeIndex(location.pathname, routes),
    }
    let settling = false
    let suppressClick = false
    let cancelAnimation: (() => void) | undefined
    let routeTimer: number | undefined
    let clickTimer: number | undefined
    let neighborSide: 'left' | 'right' | null = null
    setNeighbor(null)

    const reset = () => {
      cancelAnimation?.()
      cancelAnimation = undefined
      window.clearTimeout(routeTimer)
      state.tracking = false
      state.dragging = false
      settling = false
      resetTrack(track)
    }

    const clearNeighbor = () => {
      neighborSide = null
      setNeighbor(null)
    }

    const finishGesture = () => {
      reset()
      clearNeighbor()
    }

    const onStart = (event: TouchEvent) => {
      // 新的触摸可以产生自己的点击，不能沿用上一手势的点击拦截。
      suppressClick = false
      window.clearTimeout(clickTimer)
      if (settling) return
      if (state.tracking) finishGesture()
      if (!media.matches || event.touches.length !== 1 || state.index < 0) return
      const touch = event.touches[0]
      state.tracking = true
      state.dragging = false
      state.blocked = isBlockedTarget(event.target)
      state.startX = touch.clientX
      state.startY = touch.clientY
      state.dx = 0
      state.sourceUrl = window.location.href
    }

    const onMove = (event: TouchEvent) => {
      if (!state.tracking || state.blocked) return
      if (event.touches.length !== 1) {
        finishGesture()
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
        if (neighborSide) clearNeighbor()
      } else {
        state.dx = dx
        const side = direction > 0 ? 'right' : 'left'
        if (neighborSide !== side) {
          neighborSide = side
          setNeighbor({ path: routes[target], side })
        }
      }
      track.style.transform = `translate3d(${state.dx}px, 0, 0)`
    }

    const onEnd = () => {
      if (!state.tracking) return
      state.tracking = false
      if (!state.dragging) return
      state.dragging = false
      settling = true
      suppressClick = true
      clickTimer = window.setTimeout(() => {
        suppressClick = false
      }, 80)

      const direction = state.dx < 0 ? 1 : -1
      const target = stepIndex(state.index, routes.length, direction)
      const width = track.clientWidth || window.innerWidth
      const commit = target !== null && Math.abs(state.dx) > Math.min(72, width * 0.18)
      const distance = width + GAP_PX
      state.dx = 0

      if (commit && target !== null) {
        cancelAnimation = animate(
          track,
          `translate3d(${direction > 0 ? -distance : distance}px, 0, 0)`,
          reduce.matches ? 0 : OUT_MS,
          () => {
            // BrowserRouter 可能已更新地址栏，下一页内容仍在等待 React 提交。
            if (window.location.href !== state.sourceUrl) {
              finishGesture()
              return
            }
            routeTimer = window.setTimeout(finishGesture, 600)
            navigate(routes[target])
          },
        )
      } else {
        cancelAnimation = animate(track, 'translate3d(0, 0, 0)', reduce.matches ? 0 : BACK_MS, finishGesture)
      }
    }

    const onCancel = () => {
      if (state.tracking) finishGesture()
    }

    const onClick = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return
      event.preventDefault()
      event.stopPropagation()
      suppressClick = false
    }

    surface.addEventListener('touchstart', onStart, { passive: true })
    surface.addEventListener('touchmove', onMove, { passive: false })
    surface.addEventListener('touchend', onEnd, { passive: true })
    surface.addEventListener('touchcancel', onCancel, { passive: true })
    surface.addEventListener('click', onClick, true)
    window.addEventListener('popstate', finishGesture)
    return () => {
      surface.removeEventListener('touchstart', onStart)
      surface.removeEventListener('touchmove', onMove)
      surface.removeEventListener('touchend', onEnd)
      surface.removeEventListener('touchcancel', onCancel)
      surface.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', finishGesture)
      window.clearTimeout(clickTimer)
      reset()
    }
  }, [location, navigate, routes])

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
