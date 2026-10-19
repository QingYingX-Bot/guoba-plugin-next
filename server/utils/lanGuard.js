import os from 'node:os'
import path from 'node:path'
import {cfg} from '#guoba.platform'
import {inCidr, getClientIp} from './clientIp.js'

/**
 * 外网访问闸门。
 *
 * 默认只让「局域网」打开面板：回环、内网网段、以及和服务器落在同一个网段里的地址。
 *
 * 为什么不能只判「私有网段」：IPv6 没有 NAT，主人在自己家里用公网 IPv6 地址访问，
 * 源地址照样是运营商发的公网 IPv6（240e:3bb:654:91a0:...），判私有段会把主人自己锁在门外。
 * 所以真正的判据是「和服务器同一个网段」——同一台宽带路由后面就同前缀。
 *
 * IPv6 前缀会被运营商轮换（这台机器上见过 91a0 和 2900 两套），
 * 所以网卡列表不能只取一次，要带缓存地重读。
 */

/** 任何情况下都算内网的段 */
const PRIVATE_CIDRS = [
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', '100.64.0.0/10',
  '::1/128', 'fe80::/10', 'fc00::/7',
]

/** 本机网卡 CIDR 缓存（60 秒） */
let cache = {at: 0, cidrs: []}

/** 本机所有网卡的地址段 */
function localCidrs() {
  if (Date.now() - cache.at < 60_000) return cache.cidrs
  const cidrs = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const item of ifaces[name] ?? []) {
      if (!item?.address) continue
      cidrs.push(item.cidr || item.address)
    }
  }
  cache = {at: Date.now(), cidrs}
  return cidrs
}

/** 地址是否落在局域网（含回环） */
export function isLanIp(rawIp) {
  if (!rawIp) return false
  // IPv6 的 zone id（fe80::1%eth0）不是地址的一部分
  const ip = String(rawIp).split('%')[0]
  for (const cidr of PRIVATE_CIDRS) {
    if (inCidr(ip, cidr)) return true
  }
  for (const cidr of localCidrs()) {
    if (inCidr(ip, cidr)) return true
  }
  return false
}

/** 这次请求是不是来自局域网 */
export function isLanRequest(req) {
  return isLanIp(getClientIp(req))
}

/** 是否开着「只允许局域网」 */
export function isLanOnly() {
  try {
    return cfg.get('server.lanOnly') !== false
  } catch {
    // 读不到配置时按关闭外网处理，宁可拦住也别漏
    return true
  }
}

const FORBIDDEN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>面板未开放外网访问</title>
<style>
  :root { color-scheme: light dark }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font: 15px/1.7 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #14161b; color: #e8eaed; }
  .box { max-width: 30rem; padding: 2rem 1.6rem; text-align: center }
  h1 { font-size: 1.15rem; margin: 0 0 .8rem; font-weight: 600 }
  p { margin: .4rem 0; color: #9aa0a6 }
  code { padding: .15rem .4rem; border-radius: .3rem; background: #23262d; color: #e8eaed }
</style></head>
<body><div class="box">
  <h1>锅巴面板未开放外网访问</h1>
  <p>这个面板目前只允许在局域网内打开。</p>
  <p>确实需要从外网访问，请在聊天里给机器人发 <code>#开启锅巴外网</code>，用完记得发 <code>#关闭锅巴外网</code>。</p>
</div></body></html>`

/**
 * 归一化请求路径：去掉查询串、解码百分号转义、消解 . 与 ..、合并多余斜杠、转小写。
 *
 * Express 路由不区分大小写、按解码后的路径匹配；闸门如果拿原始 URL 做 startsWith，
 * `/./guoba/...` 这类写法会绕过闸门却仍然命中锅巴路由。这里必须和路由看到同一个路径。
 */
function normalizeUrlPath(raw) {
  let url = String(raw || '')
  const cut = url.indexOf('?')
  if (cut >= 0) url = url.slice(0, cut)
  // 反斜杠在部分宿主里也会被当作分隔符，统一成 /
  url = url.replace(/\\/g, '/')
  try {
    url = decodeURIComponent(url)
  } catch {
    // 解码失败就按原样判断，宁可多拦
  }
  url = path.posix.normalize(url).replace(/^\/{2,}/, '/')
  if (!url.startsWith('/')) url = '/' + url
  return url.toLowerCase()
}

function toPrefix(value) {
  if (value === '/') return '/'
  return normalizeUrlPath(value).replace(/\/+$/, '')
}

/**
 * 把闸门挂到锅巴的 app 上。
 *
 * 必须排在任何锅巴路由之前：只拦锅巴自己的路径（共享端口模式下宿主还有别的路由，
 * 那不是锅巴该管的），命中非局域网请求就直接 403。
 *
 * @param app express 实例
 * @param mounts 锅巴自己的挂载前缀列表（如 /guoba/、/guoba-plugin-mock-root）
 */
export function installLanGuard(app, mounts) {
  const prefixes = (Array.isArray(mounts) ? mounts : [mounts])
    .filter(Boolean)
    .map(toPrefix)
  app.use((req, res, next) => {
    if (!isLanOnly()) return next()
    const url = normalizeUrlPath(req.originalUrl || req.url || '')
    // '/' 表示锅巴独占整个站点，这时全部请求都归锅巴管
    const owned = prefixes.some(prefix => prefix === '/'
      || url === prefix
      || url.startsWith(prefix + '/'))
    if (!owned) return next()
    if (isLanRequest(req)) return next()
    res.status(403).type('html').send(FORBIDDEN_PAGE)
  })
}
