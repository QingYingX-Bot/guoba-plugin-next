/**
 * 消息记录页的会话偏好：置顶、拉黑、群备注。
 *
 * 三样都是「面板自己的状态」，不属于任何适配器，存一份 JSON 就够 —— 锅巴别的面板数据
 * 也是这么落的（见 CustomPageStoreService 的 data/guoba/custom-pages）。
 *
 * 文件：`data/guoba/chat-prefs.json`
 * ```
 * {
 *   "version": 1,
 *   "pins":      { "12345:group:67890": 1760000000000 },
 *   "blacklist": { "12345:group:67890": 1760000000000 },
 *   "notes":     { "12345:group:67890": "自家小群" }
 * }
 * ```
 * key 就是会话 key（`botId:type:id`，与 ChatService 的活跃表同一套写法），置顶/拉黑的值
 * 记一个时间戳，备注记用户填的文本。key 里已经带了账号，所以同一个群被两个号看着时，
 * 各自置顶、各自拉黑、各自备注，不会互相带过去 —— QQBot-Web-Adapter 也是按 selfId 分的。
 *
 * 读失败（文件不在、内容坏了）一律从空开始：偏好丢了只是列表顺序不对，
 * 不该把「看消息」这件事一起拖垮。写失败只记 debug 日志，返回值交给调用方决定要不要提示。
 */

import fs from 'fs'
import path from 'path'
// 同目录的 bots.js / avatar.js 都走相对路径，这里跟着来，不依赖 #guoba.* 别名
import {_paths} from '../../../../utils/paths.js'

const FILE = path.join(_paths.data, 'guoba', 'chat-prefs.json')
const VERSION = 1

/**
 * @type {{version: number, pins: Record<string, number>,
 *         blacklist: Record<string, number>, notes: Record<string, string>} | null}
 */
let cache = null

function blank() {
  return {version: VERSION, pins: {}, blacklist: {}, notes: {}}
}

/** 把任意输入收敛成一张「key -> 时间戳」的表 */
function asMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, at] of Object.entries(value)) {
    const k = String(key ?? '').trim()
    if (!k) continue
    out[k] = Number(at) || 0
  }
  return out
}

/**
 * 把任意输入收敛成一张「key -> 文本」的表。
 *
 * 群备注要能长能短还能带换行，但面板上只当一行标签用，所以顺手把控制字符抹掉、
 * 截到 64 字 —— 免得有人粘一篇小作文进来把列表撑开。
 */
const NOTE_MAX = 64
function asNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, text] of Object.entries(value)) {
    const k = String(key ?? '').trim()
    if (!k) continue
    const t = cleanNote(text)
    if (t) out[k] = t
  }
  return out
}

/** 群备注统一在这里过一遍：去控制字符、压空白、限长 */
export function cleanNote(text) {
  return String(text ?? '')
    // 换行 / 制表这些在列表里会把行高顶开，统一压成空格
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX)
}

function load() {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    cache = {
      version: VERSION,
      pins: asMap(raw?.pins),
      blacklist: asMap(raw?.blacklist),
      notes: asNotes(raw?.notes),
    }
  } catch {
    cache = blank()
  }
  return cache
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), {recursive: true})
    fs.writeFileSync(FILE, JSON.stringify(load(), null, 2), 'utf8')
    return true
  } catch (err) {
    logger?.debug?.(`[Guoba] 保存会话偏好失败：${err?.message ?? err}`)
    return false
  }
}

/** 在 pins / blacklist 里增删一个 key，返回落盘是否成功 */
function toggle(field, key, on) {
  const k = String(key ?? '').trim()
  if (!k) return false
  const state = load()
  if (on) state[field][k] = Date.now()
  else delete state[field][k]
  return save()
}

/* ---------------- 置顶 ---------------- */

export function isPinned(key) {
  return !!load().pins[String(key ?? '').trim()]
}

/**
 * 置顶 / 取消置顶。
 *
 * @return {boolean} 落盘成功与否。内存里已经改过了，写失败只意味着重启后会丢
 */
export function setPinned(key, pinned) {
  return toggle('pins', key, !!pinned)
}

/** 全部置顶项（key -> 时间戳），前端要按账号分就自己筛 key 前缀 */
export function pinnedSnapshot() {
  return {...load().pins}
}

/* ---------------- 拉黑 ---------------- */

export function isBlacklisted(key) {
  return !!load().blacklist[String(key ?? '').trim()]
}

/**
 * 拉黑 / 取消拉黑。
 *
 * 注意这里只记「锅巴面板认为它被拉黑了」，真正让机器人不理这个群的是适配器 /
 * 别的插件那一侧的名单（QQBot 系见 model/qqbotBlacklist.js）。
 */
export function setBlacklisted(key, blacklisted) {
  return toggle('blacklist', key, !!blacklisted)
}

export function blacklistSnapshot() {
  return {...load().blacklist}
}

/* ---------------- 群备注 ---------------- */

/** 这个会话的备注，没设过是空串 */
export function getNote(key) {
  return load().notes[String(key ?? '').trim()] ?? ''
}

/**
 * 设置 / 清除备注。传空串或纯空白就是清除。
 *
 * 备注是**用户自己给群起的名字**，不来自任何适配器 —— QQ 官方机器人的群名是 openid
 * 那一套里最没法看的东西（有的群名干脆取不到），给它起个能认出来的名字是刚需。
 * QQBot-Web-Adapter 也是这么做的（它存在 redis 的 wind-group-name），锅巴这边
 * 跟着置顶/拉黑一起落在同一个 JSON 里。
 *
 * @return {boolean} 落盘成功与否
 */
export function setNote(key, note) {
  const k = String(key ?? '').trim()
  if (!k) return false
  const state = load()
  const text = cleanNote(note)
  if (text) state.notes[k] = text
  else delete state.notes[k]
  return save()
}

/** 全部备注（key -> 文本） */
export function notesSnapshot() {
  return {...load().notes}
}
