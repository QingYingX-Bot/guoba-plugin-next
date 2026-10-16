/**
 * QQBot 消息的 Redis 读取。
 *
 * QQ 官方机器人（QQBot 适配器）没有 `getChatHistory` —— 消息不在 QQ 服务端可查的历史里，
 * 而是由 QQBot-Plugin 按 `Bot.storageBackend` 落库；后端选成 redis
 * （`storageBackend: redis`）时就写在这几个 ZSET 里：
 *
 *   用户消息    wind-msg:group:{selfId:groupOpenid}    wind-msg:private:{selfId:openid}
 *   机器人消息  wind-bot-msg:group:{groupOpenid}       wind-bot-msg:private:{selfId:openid}
 *   群通知      wind-msg:group:{selfId:groupOpenid}（记录里带 is_notice 标记）
 *
 * 群消息的两种 id 写法在写入侧是混用的 —— 收消息时用带 selfId 前缀的完整形式，而
 * `sendGroupMsg` 走的是纯 groupOpenid（见 QQBot-Plugin/lib/message.js 的 saveBotMessage）。
 * 所以两个键都查一遍
 *
 * 这里只读不写。键名与 QQBot-Plugin/lib/message.js 一一对应，那边改了要同步。
 */

/**
 * 取全局 redis 客户端。
 *
 * `global.redis` 是 lib/config/redis.js 的包装类，真正的 node-redis 客户端在 `.redis` 上
 * （同 DataService 的取法）。少一样方法就当作没接上，交给上层回退。
 */
export function getRedisClient() {
  const client = globalThis.redis?.redis ?? globalThis.redis
  return typeof client?.zRange === 'function' && typeof client?.sendCommand === 'function'
    ? client
    : null
}

/** 这个账号是不是 QQ 官方机器人（QQBot 适配器） */
export function isQQBot(bot) {
  const tag = String(bot?.adapter?.id ?? bot?.adapter?.name ?? '').toLowerCase()
  return tag.includes('qqbot')
}

/**
 * 纯 openid：`${selfId}:${openid}` 去掉账号前缀。
 */
export function pureId(id) {
  const s = String(id ?? '')
  const i = s.lastIndexOf(':')
  return i === -1 ? s : s.slice(i + 1)
}

/**
 * 一个会话的消息可能落在哪几个 ZSET 上。
 *
 * @param type 'group' | 'friend'
 * @param id   会话 id（群 / 好友列表里那个，群是 `${selfId}:${groupOpenid}`）
 */
export function qqRedisKeys(type, id) {
  const full = String(id ?? '')
  if (!full) return []
  const pure = pureId(full)
  const ids = pure === full ? [full] : [full, pure]
  const prefix = type === 'group' ? 'group' : 'private'
  return [...new Set(ids.flatMap((one) => [`wind-msg:${prefix}:${one}`, `wind-bot-msg:${prefix}:${one}`]))]
}

/**
 * 一条消息的稳定标识，用来跨 key 去重 —— 同一条可能同时落在 wind-msg 与 wind-bot-msg 里。
 */
export function redisUid(item) {
  return String(
    item?.msg_idx || item?.message_id
    || `${item?.timestamp ?? 0}_${item?.user_id ?? ''}_${item?.event_id ?? ''}`,
  )
}

/**
 * 分页游标：`时间戳|同秒序号`。
 *
 * ZSET 的 score 只到秒，一个群里同一秒好几条是常事。只用时间戳翻页会把这些同秒消息
 */
export function encodeCursor(ts, ordinal) {
  return `${Number(ts) || 0}|${ordinal}`
}

export function decodeCursor(seq) {
  const m = String(seq ?? '').match(/^(-?\d+(?:\.\d+)?)\|(\d+)$/)
  if (!m) return null
  return {ts: Number(m[1]), ordinal: Number(m[2])}
}

/** 一页要多取几条：跨 key 去重与同秒分组都需要余量 */
const OVER_FETCH = 20

/**
 * 读一页，新的在前。
 *
 * @param client  node-redis 客户端
 * @param keys    这个会话可能的 ZSET
 * @param cursor  上一页最老那条的游标；null 表示取最新一页
 * @param want    要几条
 * @return {Promise<{items: Array<{item: object, ts: number, ordinal: number}>, hasMore: boolean}>}
 */
export async function readPage(client, keys, cursor, want) {
  // 上一页跳过的那几条同秒消息也得取回来，序号才对得上
  const fetchN = Math.max(want + OVER_FETCH, (cursor?.ordinal ?? 0) + want + 1)
  const raws = []
  for (const key of keys) {
    let list = []
    try {
      if (cursor) {
        // 上界用闭区间：把整块同秒消息都取回来，再按序号跳过已经看过的
        list = await client.sendCommand([
          'ZREVRANGEBYSCORE', key, String(cursor.ts), '-inf', 'LIMIT', '0', String(fetchN),
        ])
      } else {
        // 首页取每个 key 最后 fetchN 条，zRange 是升序，翻过来变新的在前
        const tail = await client.zRange(key, -fetchN, -1)
        list = Array.isArray(tail) ? [...tail].reverse() : []
      }
    } catch (err) {
      // 键不存在、类型不对都不该让整页失败，记一条就够了
      logger.debug(`[Guoba][消息记录] 读 QQBot Redis（${key}）失败：${err?.message ?? err}`)
    }
    for (const raw of list ?? []) raws.push(String(raw))
  }

  const seen = new Set()
  const rows = []
  for (const raw of raws) {
    let item
    try {
      item = JSON.parse(raw)
    } catch {
      continue
    }
    if (!item || typeof item !== 'object') continue
    const uid = redisUid(item)
    if (seen.has(uid)) continue
    seen.add(uid)
    rows.push({item, raw, ts: Number(item.timestamp) || 0})
  }

  /**
   * 排序与 Redis 内部一致：score 降序、同分按成员降序。
   *
   * 这不只是为了好看 —— `ZREVRANGEBYSCORE ... LIMIT 0 N` 截断时取的就是这个顺序的前 N 条，
   * 自己排成同一个顺序，截断点才稳定，「同秒第几条」在两次请求之间才对得上。
   */
  rows.sort((a, b) => (b.ts - a.ts) || b.raw.localeCompare(a.raw))

  // 同秒的连续块内编号：第 i 条落在它那一块的第几位
  let runStart = 0
  let prev = null
  rows.forEach((row, i) => {
    if (row.ts !== prev) {
      runStart = i
      prev = row.ts
    }
    row.ordinal = i - runStart
  })

  const start = cursor ? cursor.ordinal + 1 : 0
  return {items: rows.slice(start, start + want), hasMore: rows.length > start + want}
}

/**
 * 群通知压成一行文本，页面上当一条系统消息显示。
 *
 * 通知记录与普通消息同存一个 ZSET（见 QQBot-Plugin/lib/notice.js），只有 sub_type 不同。
 */
export function noticeText(item) {
  const who = item?.nickname && item.nickname !== '未知' ? item.nickname : (item?.user_id ?? '')
  const bot = item?.bot_nickname || '机器人'
  switch (item?.sub_type) {
    case 'increase':
      return `${who} 加入了群聊`
    case 'decrease':
      return `${who} 退出了群聊`
    case 'add':
      return `机器人「${bot}」被拉入群聊`
    case 'del':
      return `机器人「${bot}」被移出群聊`
    case 'request':
      return `${who} 申请加群`
    default:
      return `群通知：${item?.sub_type ?? ''}`
  }
}
