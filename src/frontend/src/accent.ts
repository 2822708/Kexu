/**
 * 主题色（强调色）计算。
 *
 * 用户只选色相/主题，饱和度与明度由这里统一决定，保证：
 * - 浅色主题下白字对比度 ≥ 4.5:1；
 * - 深色主题下与卡片背景对比度 ≥ 4.5:1；
 * - 浅底上的强调文字同样可读。
 * 全部基于 OKLCH，避免直接改 HSL 带来的感知亮度跳变。
 */

export interface AccentPreset {
  id: string
  label: string
  hue: number
  chroma: number
}

export interface AccentChoice {
  id: string
  hue: number
  chroma: number
}

export interface AccentTone {
  base: string
  hover: string
  soft: string
  ink: string
}

export interface AccentPalette {
  light: AccentTone
  dark: AccentTone
}

const WHITE = '#ffffff'
const DARK_CARD = '#172a35'

/** 预设与默认值。default 保持现有配色，不参与计算。 */
export const DEFAULT_ACCENT_HEX = '#167d9a'

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'default', label: '默认青蓝', hue: 205, chroma: 0.09 },
  { id: 'pine', label: '松针绿', hue: 158, chroma: 0.09 },
  { id: 'moss', label: '苔绿', hue: 120, chroma: 0.09 },
  { id: 'terracotta', label: '陶土', hue: 45, chroma: 0.125 },
  { id: 'ochre', label: '赭石', hue: 85, chroma: 0.095 },
  { id: 'plum', label: '梅紫', hue: 340, chroma: 0.1 },
  { id: 'graphite', label: '石墨青', hue: 150, chroma: 0.03 },
]

export const CUSTOM_ACCENT: AccentPreset = { id: 'custom', label: '自定义', hue: 205, chroma: 0.09 }

function oklchToRgb(L: number, C: number, hue: number): [number, number, number] {
  const hr = (hue * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)

  const l = L + 0.3963377774 * a + 0.2158037573 * b
  const m = L - 0.1055613458 * a - 0.0638541728 * b
  const s = L - 0.0894841775 * a - 1.291485548 * b

  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s

  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
}

function gamma(x: number): number {
  const v = Math.min(1, Math.max(0, x))
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

function toHex(L: number, C: number, hue: number): string | null {
  const [r, g, b] = oklchToRgb(L, C, hue)
  if (Math.min(r, g, b) < -0.002 || Math.max(r, g, b) > 1.002) return null
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.round(gamma(v) * 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
}

export function relativeLuminance(hex: string): number {
  const rgb = [channel(hex, 0), channel(hex, 1), channel(hex, 2)]
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** 从亮到暗查找第一个达到目标对比度的颜色。 */
function darkerUntil(hue: number, chroma: number, against: string, target: number): string {
  for (let step = 200; step > 9; step -= 1) {
    const hex = toHex(step / 200, chroma, hue)
    if (hex && contrastRatio(hex, against) >= target) return hex
  }
  return '#000000'
}

/** 从暗到亮查找第一个达到目标对比度的颜色。 */
function lighterUntil(hue: number, chroma: number, against: string, target: number): string {
  for (let step = 10; step < 201; step += 1) {
    const hex = toHex(step / 200, chroma, hue)
    if (hex && contrastRatio(hex, against) >= target) return hex
  }
  return '#ffffff'
}

function nearWhite(hue: number, chroma: number): string {
  for (let i = 0; i < 40; i += 1) {
    const hex = toHex(0.945 - i * 0.002, chroma, hue)
    if (hex) return hex
  }
  return '#f5f8fa'
}

export function buildPalette(choice: AccentChoice): AccentPalette {
  const { hue, chroma } = choice
  const soft = nearWhite(hue, Math.max(chroma * 0.3, 0.012))
  const darkSoft = toHex(0.3, Math.max(chroma * 0.55, 0.02), hue) ?? '#203f4c'
  const darkBase = lighterUntil(hue, chroma * 1.1, DARK_CARD, 5.4)

  return {
    light: {
      base: darkerUntil(hue, chroma, WHITE, 4.6),
      hover: darkerUntil(hue, chroma, WHITE, 6.0),
      soft,
      ink: darkerUntil(hue, chroma, soft, 4.6),
    },
    dark: {
      base: darkBase,
      hover: lighterUntil(hue, chroma * 1.1, DARK_CARD, 6.6),
      soft: darkSoft,
      ink: darkBase,
    },
  }
}

/** 预设的展示用色（默认项直接给出既有主色）。 */
export function presetSwatch(preset: AccentPreset): string {
  if (preset.id === 'default') return DEFAULT_ACCENT_HEX
  return buildPalette({ id: preset.id, hue: preset.hue, chroma: preset.chroma }).light.base
}

export function parseChoice(raw: string | null): AccentChoice | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const { id, hue, chroma } = value as Record<string, unknown>
    if (typeof id !== 'string' || typeof hue !== 'number' || typeof chroma !== 'number') return null
    if (!Number.isFinite(hue) || hue < 0 || hue > 360) return null
    if (!Number.isFinite(chroma) || chroma <= 0 || chroma > 0.3) return null
    return { id, hue, chroma }
  } catch {
    return null
  }
}
