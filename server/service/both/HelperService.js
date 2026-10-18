import path from 'path'
import net from 'net'
import dns from 'dns/promises'
import fetch from 'node-fetch'
import {Result, Service, GuobaError} from '#guoba.framework';
import {_paths} from '#guoba.platform'
import {readJson} from '#guoba.utils'

/** 中转图片上限，防被拿来下载大文件 */
const TRANSIT_MAX_BYTES = 15 * 1024 * 1024
/** 最多跟随的重定向次数 */
const TRANSIT_MAX_REDIRECTS = 3
/** 单次请求超时 */
const TRANSIT_TIMEOUT = 15000
/** 禁止访问的 IPv4 网段（服务端 SSRF 兜底，域名解析出来的地址也要过这一关） */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function ipv4ToInt(ip) {
  return ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0)
}

function isBlockedV4(ip) {
  if (net.isIP(ip) !== 4) return true
  const value = ipv4ToInt(ip)
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (ipv4ToInt(base) & mask)
  })
}

/** IPv6 展开成 8 个 16 位整数，解析失败返回 null */
function expandIpv6(ip) {
  let text = ip.toLowerCase()
  let embeddedV4 = null
  if (text.includes('.')) {
    const idx = text.lastIndexOf(':')
    const tail = text.slice(idx + 1)
    if (net.isIP(tail) === 4) {
      const value = ipv4ToInt(tail)
      text = text.slice(0, idx + 1) + ((value >>> 16) & 0xffff).toString(16)
        + ':' + (value & 0xffff).toString(16)
      embeddedV4 = tail
    }
  }
  const [head, tail] = text.split('::')
  const left = head ? head.split(':').filter(Boolean) : []
  const right = tail ? tail.split(':').filter(Boolean) : []
  const parts = text.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left
  if (parts.length !== 8) return null
  const nums = parts.map(part => parseInt(part, 16))
  return nums.some(Number.isNaN) ? null : {nums, embeddedV4}
}

function isBlockedV6(ip) {
  const parsed = expandIpv6(ip)
  if (!parsed) return true
  const {nums, embeddedV4} = parsed
  const first = nums[0]
  // :: 与 ::1
  if (nums.every(n => n === 0)) return true
  if (nums.slice(0, 7).every(n => n === 0) && nums[7] === 1) return true
  // fc00::/7 唯一本地、fe80::/10 链路本地、ff00::/8 组播
  if ((first & 0xfe00) === 0xfc00) return true
  if ((first & 0xffc0) === 0xfe80) return true
  if ((first & 0xff00) === 0xff00) return true
  // 2001:db8::/32 文档地址
  if (first === 0x2001 && nums[1] === 0x0db8) return true
  // ::ffff:0:0/96（IPv4 映射）与 ::/96（IPv4 兼容）
  const mapped = nums.slice(0, 5).every(n => n === 0) && (nums[5] === 0xffff || nums[5] === 0)
  if (mapped) {
    if (embeddedV4) return isBlockedV4(embeddedV4)
    const value = ((nums[6] << 16) | nums[7]) >>> 0
    const ipv4 = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.')
    return isBlockedV4(ipv4)
  }
  // 64:ff9b::/96 NAT64、2002::/16 6to4 里嵌的 IPv4 也过一遍
  if (first === 0x0064 && nums[1] === 0xff9b) {
    const value = ((nums[6] << 16) | nums[7]) >>> 0
    return isBlockedV4([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.'))
  }
  if (first === 0x2002) {
    return isBlockedV4([nums[1] >>> 8, nums[1] & 0xff, nums[2] >>> 8, nums[2] & 0xff].join('.'))
  }
  return false
}

function isBlockedIp(ip) {
  const version = net.isIP(ip)
  if (version === 4) return isBlockedV4(ip)
  if (version === 6) return isBlockedV6(ip)
  return true
}

/** 带超时的 DNS 解析：解析结果里的每一个地址都必须过内网校验 */
async function resolveAll(hostname) {
  let timer
  try {
    return await Promise.race([
      dns.lookup(hostname, {all: true, verbatim: true}),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('解析超时')), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 限制读取大小：兼容 WHATWG ReadableStream 与 node-fetch v2 的 Node Stream */
async function readLimitedBody(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > limit) throw new Error('图片过大')
  const body = response.body
  if (!body) return Buffer.alloc(0)
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      total += value.length
      if (total > limit) {
        try {
          reader.cancel()
        } catch {
        }
        throw new Error('图片过大')
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  }
  if (typeof body.on === 'function') {
    return await new Promise((resolve, reject) => {
      const chunks = []
      let total = 0
      body.on('data', chunk => {
        total += chunk.length
        if (total > limit) {
          body.destroy?.()
          reject(new Error('图片过大'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      body.on('end', () => resolve(Buffer.concat(chunks)))
      body.on('error', reject)
    })
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > limit) throw new Error('图片过大')
  return buffer
}

function makeTimeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
  } catch {
    // 老 Node 没有 AbortSignal.timeout，退回 node-fetch v2 的 timeout 选项
  }
  return undefined
}

export default class HelperService extends Service {
  constructor(app) {
    super(app)
  }

  /**
   * 转发外链图片（插件 README 用）。
   *
   * ⚠️ 这个接口会替调用方发请求，必须防成 SSRF：
   *  - 只允许 GET/HEAD，且响应必须是图片；
   *  - 协议只收 http/https；
   *  - 域名先解析，解析出的每个 IP 都要过内网/回环/链路本地/组播黑名单
   *    （IPv4、IPv6、IPv4 映射、NAT64、6to4 都算）；
   *  - 不跟随 fetch 自动重定向，自己逐跳校验，最多 3 跳；
   *  - 限制 15MB 和 15 秒，响应头只回传 Content-Type；
   *  - 调用方的其它 query 一律不转发，避免把面板令牌带给外部站点。
   */
  async transitRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return Result.error('仅支持 GET/HEAD', 405)
    }
    const {url} = req.query
    if (!url || typeof url !== 'string') {
      return Result.error('url不能为空', 400)
    }
    let target
    try {
      target = new URL(url)
    } catch {
      return Result.error('无效的URL', 400)
    }
    for (let hop = 0; hop <= TRANSIT_MAX_REDIRECTS; hop++) {
      const check = await this.#checkTransitTarget(target)
      if (!check.ok) {
        return Result.error(check.message, 403)
      }
      let response
      try {
        response = await fetch(target.toString(), {
          method: req.method,
          redirect: 'manual',
          timeout: TRANSIT_TIMEOUT,
          signal: makeTimeoutSignal(TRANSIT_TIMEOUT),
          headers: {'user-agent': 'Guoba-Plugin/README-Proxy'},
        })
      } catch (e) {
        logger.error('[Guoba] 中转图片请求失败：' + (e?.message || e))
        return Result.error('请求失败', 502)
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) return Result.error('重定向地址缺失', 502)
        try {
          target = new URL(location, target)
        } catch {
          return Result.error('重定向地址无效', 502)
        }
        continue
      }
      if (!response.ok) {
        return Result.error('请求失败', response.status)
      }
      const contentType = String(response.headers.get('content-type') || '')
      if (!/^image\//i.test(contentType)) {
        return Result.error('只允许图片', 403)
      }
      let buffer
      try {
        buffer = await readLimitedBody(response, TRANSIT_MAX_BYTES)
      } catch (e) {
        return Result.error(e.message || '图片过大', 413)
      }
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Content-Length', String(buffer.length))
      return buffer
    }
    return Result.error('重定向次数过多', 502)
  }

  /** 校验中转目标：协议、主机名、DNS 解析结果都必须安全 */
  async #checkTransitTarget(target) {
    if (!['http:', 'https:'].includes(target.protocol)) {
      return {ok: false, message: '仅支持 http/https 协议'}
    }
    const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!hostname) return {ok: false, message: '无效的URL'}
    // IP 直连：直接按地址判断
    if (net.isIP(hostname)) {
      return isBlockedIp(hostname)
        ? {ok: false, message: '禁止访问内部地址'}
        : {ok: true}
    }
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan')
    ) {
      return {ok: false, message: '禁止访问内部地址'}
    }
    let addresses
    try {
      addresses = await resolveAll(hostname)
    } catch (e) {
      return {ok: false, message: '地址解析失败'}
    }
    if (!addresses.length || addresses.some(item => isBlockedIp(item.address))) {
      return {ok: false, message: '禁止访问内部地址'}
    }
    return {ok: true}
  }


  /** 城市名 → 城市编码，文件不小，读一次缓存住 */
  getCityMap() {
    if (!this._cityMap) {
      let cityJsonPath = path.join(_paths.pluginResources, 'json/city.json')
      this._cityMap = readJson(cityJsonPath)
    }
    return this._cityMap
  }

  /** 全部可选城市名 */
  getCityNames() {
    return Object.keys(this.getCityMap())
  }

  /** 是否是支持的城市（9 位编码也算） */
  isCitySupported(city) {
    if (/^\d{9}$/.test(city)) {
      return true
    }
    return Boolean(this.getCityMap()[city])
  }

  /** 获取天气（中国天气网） */
  async getWeather(city) {
    let cityCode
    if (/^\d{9}$/.test(city)) {
      cityCode = city
    } else {
      cityCode = this.getCityMap()[city]
      if (!cityCode) {
        return `城市${city}不存在或不支持`
      }
    }
    // 原 data/cityinfo 接口已下线：它现在照样返回 200，但内容是一整页 HTML，
    // 直接 response.json() 会抛 SyntaxError。改用仍在服务的 dingzhi 接口，
    // 返回体是 JSONP 风格的 `var cityDZ<code> ={...};var alarmDZ<code> ={...}`，
    // 需要自己把第一段 JSON 抠出来。不带 Referer 会拿到残缺内容。
    let url = `http://d1.weather.com.cn/dingzhi/${cityCode}.html`
    let response
    try {
      response = await fetch(url, {
        headers: {
          'Referer': 'http://www.weather.com.cn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        },
      })
    } catch (e) {
      logger.error(e)
      throw new GuobaError('天气接口查询失败，请稍后再试')
    }
    if (response.status !== 200) {
      throw new GuobaError('天气接口查询失败：' + response.status)
    }
    let text = await response.text()
    let matched = text.match(/=\s*(\{.*?\});/)
    let res
    try {
      res = matched ? JSON.parse(matched[1]) : null
    } catch (e) {
      res = null
    }
    if (!res) {
      logger.warn('[Guoba] 天气接口返回格式异常：', text.slice(0, 200))
      throw new GuobaError('获取天气数据失败，请稍后再试')
    }
    // noinspection SpellCheckingInspection
    let {weatherinfo: weatherInfo} = res
    if (weatherInfo) {
      // temp 是白天最高温、tempn 是夜间最低温，均自带 ℃ 单位
      let {cityname, temp, tempn, weather} = weatherInfo
      return `${cityname}今日${weather}，最低温${tempn}，最高温${temp}`
    } else {
      logger.warn('获取天气数据失败', res)
      throw new GuobaError('获取天气数据失败，请稍后再试')
    }
  }

  /** 获取天气 */
  async getWeather_old(city) {
    let url = `http://wthrcdn.etouch.cn/weather_mini?city=${city}`
    let response
    try {
      response = await fetch(url)
    } catch (e) {
      throw new GuobaError('天气接口查询失败，请稍后再试')
    }
    let res = await response.json()
    let {status, data} = res
    if (status === 1000) {
      return data
    } else if (status === 1002) {
      throw new GuobaError(`城市：${city} 数据不存在`)
    } else {
      logger.warn('获取天气数据失败', res)
      throw new GuobaError('获取天气数据失败，请稍后再试')
    }
  }

}