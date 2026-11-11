# 窄屏课表：响应式宽度与完整课程名（2026-11-11）

## 问题

1. 课表网格在 `TimetableGrid` 里写死了最小宽度（`56 + 7 × 112 = 840px`），手机只能横向滚动，必须缩放才能看全一周。
2. 为了“一屏放下整周”，曾经把课程名限制为 1–2 行；长名称（如“网络技术与应用（混合式）”）会被截断。
3. `day-agenda.css` 还残留 `.tt-cell { min-height: 42px }` 与 `.timetable-grid { min-width: 820px }`，前者特异性更高，会把每节重新撑到 42px。

## 目标与取舍

- **横向**：7 天必须完整显示，不横向滚动。
- **名称**：完整显示，不截断。
- **纵向**：由内容决定；课程名多时允许纵向滚动，不再强行压成一行。

## 改动

### 1. 宽度流式化

`TimetableGrid.tsx` 用 CSS 变量计算尺寸：

```ts
minWidth: calc(var(--tt-axis-width) + lanes * var(--tt-day-min))
gridTemplateColumns: var(--tt-axis-width) + minmax(n * var(--tt-day-min), 1fr)
gridTemplateRows: auto + minmax(calc(var(--tt-row-min) * var(--tt-scale)), max-content)
```

`timetable-grid.css` 中的变量：

| 变量 | 取值 |
|---|---|
| `--tt-axis-width` | `clamp(22px, 5.5vw, 56px)` |
| `--tt-day-min` | `clamp(0px, 11vw, 112px)` |
| `--tt-row-min` | 桌面 68px；≤900px 为 `clamp(34px, 6vw, 52px)` |
| 网格字号 | `calc(clamp(10px, 2.6vw, 12px) * var(--tt-scale))` |
| 课程名字号 | ≤640px 为 `clamp(9px, 2.7vw, 11px)` |

行高使用 `max-content`，长名称会把这一行撑高，不会裁切或与下一节重叠。

### 2. 清理遗留规则

删除 `day-agenda.css` 里旧版横向课表的 `min-width: 820px` 与 `min-height: 42px`，避免把新网格重新撑开。

### 3. 窄屏只保留必要信息

- 隐藏学期日期、总周数、网格上方提示、星期下的日期
- 节次列只保留节号
- 课程块在 ≤640px 隐藏地点/教师/节次副文本（点开课程可看完整信息）
- 标题、间距、周次标签用 `clamp()` 连续缩放

## 实测（iframe 模拟视口，10 门课 + 1 门超长名称）

| 视口 | 横向溢出 | 名称截断 | 纵向滚动 |
|---|---|---|---|
| 320×568 | 无 | 无（长名称行自动增高到 124px） | 有 |
| 360×640 | 无 | 无 | 有 |
| 390×844 | 无 | 无 | 无 |
| 414×896 | 无 | 无 | 无 |
| 768×1024 | 无 | 无 | 无 |

横向：320–1000px 全部 `scrollWidth = clientWidth`。纵向：只有内容确实超过可视高度时才滚动。

## 边界

- 名字优先于“整周一屏”；课程名较长时必然需要纵向滚动。
- ≤640px 不显示地点/教师，点开课程查看完整信息。
- 只在浏览器与模拟视口验证，未在真机复验；320px 级屏幕字号约 9px。
