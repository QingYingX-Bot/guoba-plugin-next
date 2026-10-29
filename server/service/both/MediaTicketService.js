import crypto from 'node:crypto'
import {GuobaError, Service} from '#guoba.framework'
import {Constant} from '#guoba.platform'

/**
 * 媒体票据。
 *
 * 备份下载、消息里的图片都是浏览器按 URL 直连，带不上请求头；以前把正式登录令牌拼进
 * query，一旦 URL 进了反代日志 / 浏览器历史 / 下载记录，等于把登录态交出去。
 * 这里改成短期票据：绑定签发时的登录令牌，限定用途，5 分钟过期，URL 里不再出现正式令牌。
 *
 * 签发接口挂在 /api/media-ticket，二级密码拦截器会先挡一道 —— 票据本身就代表
 * 「当前会话已经解锁过」，所以票据请求可以跳过二级密码。
 */
const TICKET_TTL = 300

export class MediaTicketService extends Service {

  #key(ticket) {
    return `${Constant.REDIS_PREFIX}media-ticket:${ticket}`
  }

  async issue(req, scope) {
    const token = req?.headers?.[Constant.TOKEN_KEY]
    if (typeof token !== 'string' || !token) throw new GuobaError('登录态失效')
    const ticket = crypto.randomBytes(24).toString('base64url')
    const payload = JSON.stringify({token, scope})
    await redis.set(this.#key(ticket), payload, {EX: TICKET_TTL})
    return {ticket, ttl: TICKET_TTL}
  }

  /** 校验票据并取回绑定的登录令牌；用途不符或过期都返回空 */
  async redeem(ticket, scope) {
    if (typeof ticket !== 'string' || !ticket) return ''
    const raw = await redis.get(this.#key(ticket))
    if (!raw) return ''
    let data
    try {
      data = JSON.parse(String(raw))
    } catch {
      return ''
    }
    if (!data || typeof data.token !== 'string' || !data.token) return ''
    if (data.scope !== scope) return ''
    return data.token
  }
}
