import jwt from 'jsonwebtoken'
import {autowired, Interceptor, Result} from "#guoba.framework";
import {cfg, Constant} from "#guoba.platform";
import {matchAuthPath} from "../utils/authPath.js";

// 弱令牌（只能用来访问静态资源等）
const liteInclude = [
  new RegExp('^/api/plugin/miao/help/theme/.+'),
  new RegExp('^/api/plugin/miao/help/icon$'),
  new RegExp('^/api/custom-page/asset/[^/]+/.+'),
  new RegExp('^/api/theme/background/image$'),
]

// 需要拦截的路径
const include = [
  new RegExp('^/api/.*'),
  ...liteInclude,
]

// 允许把 token 放在 query 里的路径：只能写进 <a href> / <img src> / <script src> 的接口。
// 其余接口一律走 header —— token 进了 URL 就会进日志、Referer、浏览器历史和截图。
const queryTokenAllow = [
  // 背景图由 <img src> 直接请求，带不上请求头；只读一张图，token 放 query 可接受
  new RegExp('^/api/theme/background/image$'),
  // 喵喵帮助的皮肤头图/底图和图标同样是 <img src> / CSS url() 直接请求，
  // 带不上请求头；三条都只读文件，token 放 query 可接受
  new RegExp('^/api/plugin/miao/help/theme/(main|bg)$'),
  new RegExp('^/api/plugin/miao/help/icon$'),
  new RegExp('^/api/file/download$'),
  new RegExp('^/api/file/download-dir$'),
  new RegExp('^/api/custom-page/asset/[^/]+/[^/]+$'),
  new RegExp('^/api/sandbox/asset/[^/]+$'),
  // 首页随机图 / 消息里的图片与代理、备份包下载，也都是 <img src> / <a href> 直连，
  // 带不上请求头，只能把 token 放 query（后两条另有二级密码把关）
  new RegExp('^/api/home/random-image$'),
  new RegExp('^/api/chat/asset/[^/]+$'),
  new RegExp('^/api/chat/proxy$'),
  new RegExp('^/api/backup/download$'),
  new RegExp('^/api/helper/transit$'),
]

// 不需要拦截的路径
const exclude = [
  // 仅放行登录所需的公开接口；/login/security 必须经过正式令牌校验。
  new RegExp('^/api/login$'),
  new RegExp('^/api/login/status$'),
  new RegExp('^/api/login/captcha/request$'),
  new RegExp('^/api/login/code/(request|check)$'),
  // 冻结状态查询：面板冻结时前端要靠它显示冻结页（AccessFreezeInterceptor 会放行）
  new RegExp('^/api/frozen/status$'),
  // 只认本机回环调用（HelperService 有 isLoopbackAddress 兜底）
  new RegExp('^/api/helper/release_port$'),
  // 插件图标是图片，前端 <img> 带不上请求头，放行不影响鉴权面
  new RegExp('^/api/plugin/s/.+/icon$'),
]

/**
 * Token校验拦截器
 * @param app
 */
export default class TokenInterceptor extends Interceptor {

  systemService = autowired('systemService')
  loginService = autowired('loginService')

  constructor(app) {
    super(app)
  }

  async handler(req, res, next) {
    if (!include.find(reg => this.check(reg, req))) {
      next()
    } else if (exclude.find(reg => this.check(reg, req))) {
      next()
    } else {
      // 默认只认 header；只有下载类接口允许 token 走 query
      let token = req.headers[Constant.TOKEN_KEY]
      if (!token && queryTokenAllow.some(reg => this.check(reg, req))) {
        token = req.query?.token
      }
      // iframe 里的 css/js 由浏览器按相对路径请求，带不上请求头，只能从Cookie里取。
      // 浏览器会自动携带Cookie，所以只在弱令牌路径上认它，不给其他接口留CSRF口子。
      let fromCookie = false
      if (!token && liteInclude.find(reg => this.check(reg, req))) {
        token = this.#readCookie(req, Constant.LITE_TOKEN_COOKIE)
        fromCookie = !!token
      }
      if (token) {
        // 判断是否是弱令牌
        if (token.length === 8 && token === this.systemService.getLiteToken()) {
          if (liteInclude.find(reg => this.check(reg, req))) {
            next()
            return
          }
        } else if (fromCookie) {
          // Cookie里只该放弱令牌，放了别的一律不认
        } else {
          let redisKey = Constant.REDIS_PREFIX + 'access-token:' + token
          let redisToken = await redis.get(redisKey)
          if (redisToken && this.#verify(redisToken)) {
            // 令牌续期：面板还在用就别让它掉线。
            // 续期失败绝不能影响本次放行，所以整个动作自己吞掉异常
            // （见 #renewToken），并且不 await —— 副作用不该拖慢请求。
            this.#renewToken(token)
            next()
            return
          }
        }
      }
      let result = Result.noLogin()
      res.status(result.httpStatus).json(result.toJSON())
    }
  }

  /** 校验JWT签名，异常一律当成校验失败 */
  #verify(redisToken) {
    try {
      jwt.verify(redisToken, cfg.getJwtSecret())
      return true
    } catch {
      return false
    }
  }

  /**
   * 静默续期。
   *
   * 这里连「取不到 loginService」也要一起兜住 —— 外层是放行逻辑，
   * 任何续期侧的意外都不该把一次合法请求打成未登录。
   */
  #renewToken(token) {
    try {
      this.loginService.renewToken(token)?.catch?.(() => {})
    } catch {
    }
  }

  /** 读一个Cookie，只这一处用得上，就不引 cookie-parser 了 */
  #readCookie(req, name) {
    const raw = req.headers?.cookie
    if (!raw) return null
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      if (part.slice(0, idx).trim() === name) {
        return decodeURIComponent(part.slice(idx + 1).trim())
      }
    }
    return null
  }

  /**
   * 检查是否reg是否通过校验，兼容自定义前缀
   * @param {RegExp} reg
   * @param {Request} req
   */
  check(reg, req) {
    // 路径统一归一化（小写 + 解码 + 剥挂载前缀）后再匹配。
    // Express 的路由匹配不区分大小写，若这里按原样比较，/API/login/... 就能
    // 绕过全部鉴权直接进 handler（已被实际利用过，务必保持归一化）。
    return matchAuthPath(reg, req)
  }

  static priority = 100
}
