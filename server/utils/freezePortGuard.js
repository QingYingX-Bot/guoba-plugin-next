/**
 * 冻结时的端口闸门。
 *
 * 面板冻结后要「对外关闭端口」，但不能真的 server.close()：
 * 机器人的协议端（NapCat / SnowLuma 等）也连同一个 2536 端口，
 * 关掉监听它就掉线，主人也就收不到 `#锅巴解冻`，直接把自己锁死在门外。
 *
 * 所以这里做的是「等效关闭端口」，按冻结范围分两档：
 * - `wan`（外网来源触发）：只对外网关门 —— 外网来的 HTTP 直接断、WS 升级拒绝；
 *   局域网（含回环、同网段）一切照常，面板、协议端、宿主别的接口都不受影响。
 * - `all`（局域网来源触发）：外网同上；局域网的 HTTP 交给 AccessFreezeInterceptor 回 423，
 *   局域网的 WS 只放行宿主注册过的协议端路径（OneBotv11 等），别的路径一律拒绝。
 *
 * 判「是不是局域网」和外网开关（lanGuard）用同一套规则：
 * 协议端不一定从回环连过来（Docker 桥接、另一台局域网机器上的 SnowLuma），
 * 只认回环会把它们当成外网掐掉，冻结后连解冻指令都发不进来。
 *
 * 状态挂到 globalThis，插件热重载后新旧实例读到的是同一份，不会多挂监听器。
 */

import { getClientIp } from './clientIp.js'
import { isLanIp } from './lanGuard.js'

const GUARD_KEY = Symbol.for('guoba.freeze.port-guard')
/** 宿主拿不到 WS 处理器表时（老版本云崽）兜底认的协议端路径 */
const FALLBACK_BOT_WS_PATHS = ['OneBotv11']

function state() {
  if (!globalThis[GUARD_KEY]) {
    globalThis[GUARD_KEY] = { frozen: false, server: null }
  }
  const current = globalThis[GUARD_KEY]
  // 旧版本挂的是 boolean，true 视同全面冻结
  if (current.frozen === true) current.frozen = 'all'
  // 每条 socket 建连时的真实来源（反代后取 X-Forwarded-For），断已有 WS 时要用
  if (!current.socketIps) current.socketIps = new WeakMap()
  return current
}

/**
 * 同步冻结状态。
 * @param value false 未冻结；'wan' 只对外网关门；'all'（或 true）全面冻结
 */
export function setPortFrozen(value) {
  if (!value) {
    state().frozen = false
    return
  }
  state().frozen = value === 'wan' ? 'wan' : 'all'
}

/** 当前冻结范围：false / 'wan' / 'all' */
export function getPortFrozen() {
  return state().frozen
}

export function isPortFrozen() {
  return !!state().frozen
}

/** 这个请求（HTTP 或 WS 升级）的来源是不是局域网 */
export function isLanSource(req) {
  return isLanIp(getClientIp(req))
}

/**
 * 冻结时断开已经建立的 WS 连接。
 *
 * **不能无差别 terminate**：协议端的连接也挂在同一个 wss 上，踢掉它机器人就掉线，
 * 主人连「#锅巴解冻」都发不进来 —— 而冻结是任何人「连续输错 3 次密码」就能触发的，
 * 等于给了外部一个踢线的按钮。判定和端口闸门保持一致：
 * - 外网来源的连接一律断开；
 * - `all` 时局域网连接只保留协议端路径（取不到路径的按协议端算，宁可留着也别误踢机器人）。
 */
export function closeExistingWebSockets() {
  const current = state()
  try {
    const clients = globalThis.Bot?.wss?.clients
    if (!clients || typeof clients[Symbol.iterator] !== 'function') return
    for (const client of clients) {
      try {
        if (keepConnection(client, current)) continue
        client.terminate?.()
      } catch {
        // 单个连接关不掉不影响其它
      }
    }
  } catch {
    // 宿主没有 wss 就跳过，端口闸门仍然生效
  }
}

function keepConnection(client, current) {
  const socket = client?._socket ?? client?.socket ?? client?.conn?.socket
  const recorded = socket ? current.socketIps.get(socket) : undefined
  const ip = recorded?.ip ?? getClientIp({ socket })
  if (!isLanIp(ip)) return false
  if (current.frozen !== 'all') return true
  const url = recorded?.url ?? (client?.upgradeReq ?? client?.req)?.url
  if (!url) return true
  return isBotWsPath(wsFirstSegment({ url }))
}

/** 宿主注册过的协议端 WS 路径（JiuLi / TRSS 的 Bot.wsf），拿不到就用兜底列表 */
function isBotWsPath(segment) {
  if (!segment) return false
  try {
    const wsf = globalThis.Bot?.wsf
    if (wsf && typeof wsf === 'object') return segment in wsf
  } catch {
    // 读不到处理器表就走兜底
  }
  return FALLBACK_BOT_WS_PATHS.includes(segment)
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
  // 处理逻辑每次装都换成本模块的：热重载后监听器不重挂，但判断用的是新代码
  current.handlers = createHandlers(current)
  if (!server || current.server === server) return
  current.server = server
  // prepend：必须排在 express / JiuLi 自己的 upgrade 处理之前
  server.prependListener('upgrade', (req, socket, head) => current.handlers.onUpgrade(req, socket, head))
  server.prependListener('request', (req, res) => current.handlers.onRequest(req, res))
}

function createHandlers(current) {
  const onUpgrade = (req, socket) => {
    // 不管冻没冻都记下来源：冻结那一刻要按它判断已有连接留不留
    try {
      if (socket) current.socketIps.set(socket, { ip: getClientIp(req), url: req.url })
    } catch {
      // 记不下来就退回按 socket 地址判断
    }
    if (!current.frozen) return
    if (isLanSource(req)) {
      // 只对外网关门：局域网照常
      if (current.frozen === 'wan') return
      // 全面冻结：局域网只放协议端，保证解冻指令进得来
      if (isBotWsPath(wsFirstSegment(req))) return
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
    // 局域网请求照常走：wan 时一切如常，all 时由 AccessFreezeInterceptor 返回 423
    if (isLanSource(req)) return
    // 对外表现为端口关闭：不回任何内容，直接断
    try {
      res.destroy?.()
    } catch {
      // 忽略
    }
  }

  return { onUpgrade, onRequest }
}
