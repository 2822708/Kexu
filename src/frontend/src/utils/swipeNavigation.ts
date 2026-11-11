/** 手势判定与页面步进；纯函数便于单测。 */

export type SwipeDirection = -1 | 0 | 1

/**
 * 返回 -1（上一页 / 右滑）、1（下一页 / 左滑）或 0（不构成翻页手势）。
 * 条件：横向位移达到阈值、纵向位移不过大、横向明显大于纵向。
 */
export function swipeDirection(
  dx: number,
  dy: number,
  options: { threshold?: number; maxVertical?: number; ratio?: number } = {},
): SwipeDirection {
  const threshold = options.threshold ?? 56
  const maxVertical = options.maxVertical ?? 48
  const ratio = options.ratio ?? 1.4
  if (Math.abs(dx) < threshold) return 0
  if (Math.abs(dy) > maxVertical) return 0
  if (Math.abs(dx) < Math.abs(dy) * ratio) return 0
  return dx < 0 ? 1 : -1
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
