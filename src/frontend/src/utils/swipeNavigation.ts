/** 手势判定与页面步进；纯函数便于单测。 */

/** 区分开始横向拖动、让位给纵向滚动和继续等待。 */
export function classifySwipeStart(dx: number, dy: number): 'horizontal' | 'vertical' | 'pending' {
  const horizontal = Math.abs(dx)
  const vertical = Math.abs(dy)
  if (horizontal >= 8 && horizontal >= vertical * 1.2) return 'horizontal'
  return vertical > 12 ? 'vertical' : 'pending'
}

/** 松手时，短距离拖动回到当前页。 */
export function shouldCommitSwipe(dx: number, width: number): boolean {
  return Math.abs(dx) > Math.min(72, width * 0.18)
}

/** 在固定路由列表里前进一步；越界返回 null（不循环）。 */
export function stepIndex(index: number, count: number, direction: -1 | 1): number | null {
  if (index < 0 || index >= count) return null
  const next = index + direction
  return next >= 0 && next < count ? next : null
}

/** 根据当前路径找到所属主页面下标；子路由也算（如 /tasks?view=today）。 */
export function routeIndex(pathname: string, routes: readonly string[]): number {
  return routes.findIndex(
    (route) => pathname === route || pathname.startsWith(route + '/') || pathname.startsWith(route + '?'),
  )
}
