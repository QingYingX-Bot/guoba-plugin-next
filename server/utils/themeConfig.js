import fs from 'fs'
import path from 'path'
import {GuobaError} from '#guoba.framework'
import {cfg, _paths} from '#guoba.platform'

export const THEME_MODES = ['dark', 'light']
/** 内置主题。default 实心；glass 毛玻璃 */
export const BUILTIN_THEMES = ['default', 'glass']
const RADIUS = {min: 0, max: 24}
const FONT_SIZE = {min: 12, max: 20}
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * 自定义背景图的存放目录。放在 config/ 下
 */
export const themeDir = path.join(_paths.pluginRoot, 'config/theme')

/**
 * 背景图文件名
 */
const BG_NAME_RE = /^bg-(dark|light)-(\d{10,16})\.(png|jpe?g|webp|gif|avif)$/
export const BG_ACCEPT_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']

/** 这个文件名属于哪个模式；不合法返回 null */
function bgModeOf(name) {
  const matched = BG_NAME_RE.exec(String(name ?? '').trim())
  return matched ? matched[1] : null
}

/**
 * 面板当前的外观主题
 */
export function readTheme() {
  const raw = cfg.get('theme') ?? {}
  return {
    themeId: BUILTIN_THEMES.includes(raw.themeId) ? raw.themeId : 'default',
    primaryColor: normalizeColor(raw.primaryColor) ?? '',
    borderRadius: clamp(raw.borderRadius, RADIUS, 10),
    fontSize: clamp(raw.fontSize, FONT_SIZE, 14),
    backgrounds: {
      dark: readBgFile(raw.backgrounds?.dark, 'dark'),
      light: readBgFile(raw.backgrounds?.light, 'light'),
    },
  }
}

/** 校验前端提交的设置 */
export function normalizeTheme(data = {}) {
  const themeId = String(data.themeId ?? '')
  if (!BUILTIN_THEMES.includes(themeId)) {
    throw new GuobaError(`内置主题只能是 ${BUILTIN_THEMES.join(' / ')}`)
  }

  const primaryColor = normalizeColor(data.primaryColor)
  if (primaryColor === null) throw new GuobaError('主色调只支持 #rgb 或 #rrggbb，留空表示用默认色')

  const backgrounds = {}
  for (const modeKey of THEME_MODES) {
    const value = String(data.backgrounds?.[modeKey] ?? '').trim()
    if (value && bgModeOf(value) !== modeKey) {
      throw new GuobaError(`背景图文件名不合法（${modeKey}）`)
    }
    backgrounds[modeKey] = value
  }

  return {
    themeId,
    primaryColor,
    borderRadius: assertRange(data.borderRadius, RADIUS, '圆角'),
    fontSize: assertRange(data.fontSize, FONT_SIZE, '字号'),
    backgrounds,
  }
}

/** 上传前建目录 */
export function ensureThemeDir() {
  fs.mkdirSync(themeDir, {recursive: true})
  return themeDir
}

/** 新背景图的文件名。带时间戳，换图即换名 */
export function newBgName(mode, ext) {
  return `bg-${mode}-${Date.now()}.${ext}`
}

/** 解析一个文件名到绝对路径；不合法返回 null */
export function bgFilePath(name) {
  if (!bgModeOf(name)) return null
  return path.join(themeDir, name)
}

/** 删掉某个背景图文件。config 里的记录不在这里动 */
export function deleteBgFile(name) {
  const file = bgFilePath(name)
  if (file) fs.rm(file, {force: true}, () => {})
}

/** 某个模式当前用的背景图文件名 */
export function readBgFile(raw, mode) {
  const name = String(raw ?? '').trim()
  return bgModeOf(name) === mode ? name : ''
}

/** 统一成小写 #rrggbb；空值给 ''，认不出返回 null */
function normalizeColor(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const matched = HEX_RE.exec(text)
  if (!matched) return null
  let hex = matched[1].toLowerCase()
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  return `#${hex}`
}

function assertRange(value, {min, max}, label) {
  const num = Number(value)
  if (!Number.isInteger(num)) throw new GuobaError(`${label}必须是整数`)
  if (num < min || num > max) throw new GuobaError(`${label}需在 ${min} ~ ${max} 之间`)
  return num
}

function clamp(value, {min, max}, fallback) {
  const num = Math.round(Number(value))
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback
}
