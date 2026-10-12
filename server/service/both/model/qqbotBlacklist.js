/**
 * 把「拉黑群」同步给 QQBot-Plugin。
 *
 * 锅巴自己那份（model/chatPrefs.js）只管面板上的显示与排序；真正决定机器人理不理这个群的
 * 是 QQBot-Plugin 的 `lib/blacklist.js` —— 它的 `adapter/message.js` 对每条消息都问一次
 * `isGroupBlacklisted(data.group_id)`。QQBot-Web-Adapter 的群右键菜单就是这么接的，这里照它来。
 *
 * 三个前提，缺一个就只是「锅巴面板记下了」，调用方要把 note 带回去告诉用户：
 * - QQBot-Plugin 得装着，否则 import 不到；
 * - 群 id 得是 QQBot 那套 `${selfId}:${groupOpenid}` 复合形式（QQBot-Plugin 的黑名单
 *   按整串存）—— 正好就是消息记录页的会话 id，锅巴这边不用再拼；
 * - 账号得是 QQ 官方机器人（判断在调用方，见 ChatService.setBlacklist）。
 *
 * 走动态 import 而不是顶层 import：QQBot-Plugin 是可选依赖，没装的时候锅巴照样要能起。
 */

import path from 'path'
import {pathToFileURL} from 'url'
// 同 chatPrefs.js：跟 model/ 下的邻居保持一致，用相对路径而不是 #guoba.* 别名
import {_paths} from '../../../../utils/paths.js'

/** 相对 Bot 根目录的位置，别写死成锅巴自己的相对路径 —— 两者的层级关系会变 */
const LIB_REL = path.join('plugins', 'QQBot-Plugin', 'lib', 'blacklist.js')

/** @type {Promise<object | null> | undefined} */
let libPromise

function loadLib() {
  if (!libPromise) {
    const file = path.join(_paths.root, LIB_REL)
    libPromise = import(pathToFileURL(file).href).catch(() => null)
  }
  return libPromise
}

/**
 * 同步一个群的拉黑状态。
 *
 * @param groupId      QQBot 的群 id（`${selfId}:${groupOpenid}`）
 * @param blacklisted  true 拉黑，false 取消
 * @return {Promise<{ok: boolean, note: string}>} 失败不抛错 —— 面板那边已经记下了，
 *   这只是「顺带同步」这一步的结果，调用方按 note 决定提示什么
 */
export async function mirrorGroupBlacklist(groupId, blacklisted) {
  const gid = String(groupId ?? '').trim()
  if (!gid) return {ok: false, note: '缺少群 id，没法同步黑名单'}

  const lib = await loadLib()
  if (!lib) {
    // 没装就别把失败的 promise 一直缓存着，装好之后重启一次就能接上
    libPromise = undefined
    return {ok: false, note: '没找到 QQBot-Plugin，黑名单只记在了锅巴面板里'}
  }

  try {
    if (blacklisted) await lib.blacklistGroup(gid)
    else await lib.unblacklistGroup(gid)
    return {ok: true, note: ''}
  } catch (err) {
    return {ok: false, note: `同步给 QQBot-Plugin 失败：${err?.message ?? err}`}
  }
}

/**
 * 问一下 QQBot-Plugin 那边的实际状态。
 *
 * 面板自己那份是权威（用户就是在面板上点的），这里只在列表渲染时补一个「别处也拉黑了」的
 * 判断用不上 —— 所以暂时没人调，留着是因为排查「点了没生效」时要能一眼看出两边是否一致。
 */
export async function readGroupBlacklisted(groupId) {
  const gid = String(groupId ?? '').trim()
  if (!gid) return null
  const lib = await loadLib()
  if (!lib || typeof lib.isGroupBlacklisted !== 'function') return null
  try {
    return !!lib.isGroupBlacklisted(gid)
  } catch {
    return null
  }
}
