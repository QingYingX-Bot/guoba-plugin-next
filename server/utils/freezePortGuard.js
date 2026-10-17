/**
 * 冻结时的端口闸门。
 *
 * 面板冻结后要「对外关闭端口」，但不能真的 server.close()：
 * 机器人的 OneBot 协议端（NapCat）也是从本机回环连同一个 2536 端口的，
 * 关掉监听它就掉线，主人也就收不到 `#锅巴解冻`，直接把自己锁死在门外。
 *
 * 所以这里做的是「等效关闭端口」：
 * - 非回环来源的 HTTP 请求：直接断开连接，对外表现就是端口不可用；
 * - 非机器人路径的 WebSocket 升级：一律拒绝（堵住宿主 WS 无鉴权注入的旁路）；
 * - 本机回环 + OneBotv11 路径：照常放行，保证机器人一直在线。
 *
 * 状态挂到 globalThis，插件热重载后新旧实例读到的是同一份，不会多挂监听器。
 */

const GUARD_KEY = Symbol.for('guoba.freeze.port-guard')
/** 机器人协议端的 WS 路径首段（NapCat / OneBot 11） */
const BOT_WS_PATH = 'OneBotv11'
const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1', 'localhost'])

function state() {
  if (!globalThis[GUARD_KEY]) {
    globalThis[GUARD_KEY] = { frozen: false, server: null }
  }
  return globalThis[GUARD_KEY]
}

/** 同步冻结状态（freeze / unfreeze 与每次冻结检查时调用） */
export function setPortFrozen(value) {
  state().frozen = !!value
}

export function isPortFrozen() {
  return state().frozen
}

/** 冻结时断开已经建立的 WS 连接：机器人会按回环路径自动重连，旁路连接则再也进不来 */
export function closeExistingWebSockets() {
  try {
    const clients = globalThis.Bot?.wss?.clients
    if (!clients || typeof clients[Symbol.iterator] !== 'function') return
    for (const client of clients) {
      try {
        client.terminate?.()
      } catch {
        // 单个连接关不掉不影响其它
      }
    }
  } catch {
    // 宿主没有 wss 就跳过，端口闸门仍然生效
  }
}

function isLoopback(address) {
  if (!address) return false
  const value = String(address)
  if (LOOPBACK.has(value)) return true
  // IPv4-mapped IPv6 的其它写法
  return value.startsWith('::ffff:127.') || value === '::1'
}

function wsFirstSegment(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname.split('/').filter(Boolean)[0] || ''
  } catch {
    return ''
  }
}

/**
 * 给宿主 http server 装上闸门。重复调用（热重载 / 多次初始化）只会装一次。
 * @param {import('http').Server} server
 */
export function installPortGuard(server) {
  const current = state()
  if (!server || current.server === server) return
  current.server = server

  const onUpgrade = (req, socket) => {
    if (!current.frozen) return
    // 机器人协议端：本机回环 + OneBotv11，必须放行，否则解冻指令进不来
    if (isLoopback(req.socket?.remoteAddress) && wsFirstSegment(req) === BOT_WS_PATH) {
      return
    }
    try {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
    } catch {
      // 写不出去就直接销毁
    }
    socket.destroy?.()
  }

  const onRequest = (req, res) => {
    if (!current.frozen) return
    // 本机请求照常走，由 AccessFreezeInterceptor 返回 423（冻结页 / 本机排查用）
    if (isLoopback(req.socket?.remoteAddress)) return
    // 对外表现为端口关闭：不回任何内容，直接断
    try {
      res.destroy?.()
    } catch {
      // 忽略
    }
  }

  // prepend：必须排在 express / JiuLi 自己的 upgrade 处理之前
  server.prependListener('upgrade', onUpgrade)
  server.prependListener('request', onRequest)
}
