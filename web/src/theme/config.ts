/**
 * 外观主题的数据模型与配色推导。
 *
 * 面板外观分三层：
 * - 主色调、圆角、字号 —— 喂给 antd 的 token；
 * - 内置主题（默认 / 毛玻璃）—— 决定侧栏、顶栏、卡片要不要半透明 + 背景模糊；
 * - 自定义背景图 —— 深浅各一张，铺在整块面板底下。
 */

/** 深色主题的主色：插件 icon 的暖金 */
export const BRAND = '#d19f56'
/** 浅色主题的主色：同样温润但压得住的灰绿（米白底上 4.7:1，暖金只有 2.2:1） */
export const BRAND_LIGHT = '#5f7a6b'

export type ThemeMode = 'dark' | 'light'

export type ThemeId = 'default' | 'glass'

export interface ThemeSettings {
  /** 深浅模式。只存浏览器本地（顶栏那个按钮切的），不进服务端配置 */
  mode: ThemeMode
  /** 内置主题 */
  themeId: ThemeId
  /** 主色调。空串表示用内置默认（深浅各一套） */
  primaryColor: string
  /** antd 组件圆角（px） */
  borderRadius: number
  /** 基础字号（px） */
  fontSize: number
  /** 深浅各一张自定义背景图（文件名），空串表示不铺 */
  backgrounds: Record<ThemeMode, string>
}

/** 服务端存的那一份：深浅模式不在里面 */
export type ThemePayload = Omit<ThemeSettings, 'mode'>

export const BUILTIN_THEMES: Array<{ id: ThemeId; name: string; hint: string }> = [
  { id: 'default', name: '默认', hint: '实心底色，干净利落' },
  { id: 'glass', name: '毛玻璃', hint: '侧栏、顶栏、卡片半透明 + 背景模糊，配背景图更出效果' },
]

export const RADIUS_RANGE = { min: 0, max: 24 }
export const FONT_RANGE = { min: 12, max: 20 }

/** 背景图文件名的规则，与服务端 utils/themeConfig.js 的 BG_NAME_RE 一致 */
const BG_NAME_RE = /^bg-(dark|light)-\d{10,16}\.(png|jpe?g|webp|gif|avif)$/

/** 上传时可选的图片类型 */
export const IMG_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif'

export const DEFAULT_THEME: ThemeSettings = {
  mode: 'dark',
  themeId: 'default',
  primaryColor: '',
  borderRadius: 10,
  fontSize: 14,
  backgrounds: { dark: '', light: '' },
}

export function normalizeTheme(raw: Partial<ThemeSettings> | null | undefined): ThemeSettings {
  return {
    mode: raw?.mode === 'light' ? 'light' : 'dark',
    themeId: raw?.themeId === 'glass' ? 'glass' : 'default',
    primaryColor: normalizeHex(String(raw?.primaryColor ?? '')) ?? '',
    borderRadius: clampInt(raw?.borderRadius, RADIUS_RANGE, DEFAULT_THEME.borderRadius),
    fontSize: clampInt(raw?.fontSize, FONT_RANGE, DEFAULT_THEME.fontSize),
    backgrounds: {
      dark: readBgName(raw?.backgrounds?.dark, 'dark'),
      light: readBgName(raw?.backgrounds?.light, 'light'),
    },
  }
}

/** 当前生效的主色：没自定义就按模式取内置默认 */
export function resolvePrimary(mode: ThemeMode, primaryColor: string): string {
  return normalizeHex(primaryColor) ?? (mode === 'dark' ? BRAND : BRAND_LIGHT)
}

/**
 * 由主色推出一整套 CSS 变量（styles/index.css 里 html[data-theme] 定义的那批）。
 * 浓淡比例照抄内置默认值，保证换色后的观感与默认色一致。
 */
export function brandVars(mode: ThemeMode, primaryColor: string): Record<string, string> {
  const primary = resolvePrimary(mode, primaryColor)
  const dark = mode === 'dark'
  return {
    '--g-brand': primary,
    '--g-brand-soft': withAlpha(primary, dark ? 0.14 : 0.12),
    // 再亮/再沉一档，给「靠颜色分主次」的地方（如文件夹名）
    '--g-brand-ink': shiftLightness(primary, dark ? 0.14 : -0.13),
    '--g-brand-fg': relativeLuminance(primary) > 0.179 ? '#1a1408' : '#ffffff',
    '--g-brand-line': withAlpha(primary, dark ? 0.28 : 0.26),
    '--g-brand-glow': withAlpha(primary, dark ? 0.22 : 0.14),
    '--g-brand-glow-2': withAlpha(primary, dark ? 0.1 : 0.07),
    '--g-brand-shadow': `0 6px 16px ${withAlpha(primary, dark ? 0.26 : 0.22)}`,
  }
}

/* ---------------- 颜色计算 ---------------- */

/** 这个文件名是不是该模式的背景图；不是就返回 '' */
function readBgName(raw: unknown, mode: ThemeMode): string {
  const name = String(raw ?? '').trim()
  const matched = BG_NAME_RE.exec(name)
  return matched && matched[1] === mode ? name : ''
}

function clampInt(value: unknown, { min, max }: { min: number; max: number }, fallback: number) {
  const num = Math.round(Number(value))
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback
}

/** '#abc' / '#aabbcc' → [r, g, b]，认不出返回 null */
function parseHex(hex: string): [number, number, number] | null {
  const matched = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!matched) return null
  let value = matched[1]
  if (value.length === 3) value = value.split('').map((c) => c + c).join('')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

/** 归一化成小写 #rrggbb，认不出返回 null */
function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** 只动明度、保住色相与饱和度 —— 直接往黑/白里混会把颜色洗灰 */
export function shiftLightness(hex: string, delta: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [h, s, l] = rgbToHsl(rgb)
  return hslToHex(h, s, Math.min(1, Math.max(0, l + delta)))
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/** WCAG 相对亮度。0.179 是白字与黑字对比度相等的临界点，用来挑前景色 */
function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}
