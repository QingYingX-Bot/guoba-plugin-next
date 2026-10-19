import { Service } from '#guoba.framework'
import { cfg, Constant } from '#guoba.platform'
import { sendToMasterUser, sendToOneMaster } from '#guoba.utils'
import {
  closeExistingWebSockets,
  installPortGuard,
  setPortFrozen,
} from '../../utils/freezePortGuard.js'

/**
 * 锅巴冻结。
 *
 * 二级密码连续输错 3 次，整个面板进入冻结状态：
 * 所有接口（包括登录）都拒绝，只能由主人在聊天里发送「#锅巴解冻」恢复。
 * 冻结状态不设过期时间，交给主人手动解除。
 *
 * 登录密码连错 3 次同样冻结面板（见 LoginSecurityService.handleTooManyPasswordFailures），
 * 不再重置凭证 —— 重置只会给陌生人一个「把面板打回未初始化」的按钮。
 *
 * 冻结同时会打开端口闸门（见 utils/freezePortGuard.js）：
 * 对外不再响应面板请求，只保留本机回环上的机器人协议端连接。
 */
export class AccessFreezeService extends Service {

  constructor(app) {
    super(app)
    // 进程重启后可能仍处于冻结状态：恢复端口闸门，别等第一次请求
    try {
      installPortGuard(app?.server)
    } catch (error) {
      logger.error('[Guoba] 安装冻结端口闸门失败')
      logger.error(error)
    }
    this.#syncPortState()
  }

  async #syncPortState() {
    try {
      setPortFrozen(!!(await redis.get(this.key)))
    } catch {
      // 读不到就维持未冻结，避免把面板误锁死
    }
  }

  get key() {
    return `${Constant.REDIS_PREFIX}${Constant.FROZEN_KEY}`
  }

  async isFrozen() {
    try {
      return !!(await redis.get(this.key))
    } catch {
      // 读不到状态时按未冻结处理，避免 redis 抖动把面板整体锁死
      return false
    }
  }

  /** 冻结信息：{reason, at, ip, ua}，未冻结返回 null */
  async getInfo() {
    try {
      const raw = await redis.get(this.key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  /**
   * 冻结面板。首次冻结时私聊通知主人。
   * @param reason 给主人看的原因，如「登录密码连续输错 3 次」
   * @param detail {ip, ua}
   */
  async freeze(reason, detail = {}, ttlSeconds = 0) {
    const info = {
      reason,
      at: Date.now(),
      ip: detail.ip || '',
      ua: typeof detail.ua === 'string' ? detail.ua.slice(0, 200) : '',
    }
    let existed = false
    try {
      existed = !!(await redis.get(this.key))
    } catch {
      // 忽略，照常写入
    }
    if (ttlSeconds > 0) {
      await redis.set(this.key, JSON.stringify(info), { EX: ttlSeconds })
    } else {
      await redis.set(this.key, JSON.stringify(info))
    }
    // 端口闸门立即生效，并断开已经建立的 WS（机器人会自动从回环重连）
    setPortFrozen(true)
    closeExistingWebSockets()
    // 冻结视为安全事件：所有面板登录会话与二级密码解锁凭证一并作废，
    // 解冻后要重新输入账号密码
    await this.clearSessions()
    // 同时清掉双方的错误计数：解冻后重新从 0 开始
    await this.clearAttempts()
    if (!existed) this.#notify(info)
    return info
  }

  /** 解除冻结，并把登录 / 二级密码的失败计数清空 */
  async unfreeze() {
    const existed = !!(await redis.get(this.key))
    await redis.del(this.key)
    setPortFrozen(false)
    await this.clearAttempts()
    return existed
  }

  async clearAttempts() {
    const patterns = [
      `${Constant.REDIS_PREFIX}login-captcha:*:password-*`,
      `${Constant.REDIS_PREFIX}gate:*:attempts`,
      // 旧版本留下的按 IP 锁定标记
      `${Constant.REDIS_PREFIX}gate:*:lock`,
      `${Constant.REDIS_PREFIX}gate:*:level`,
    ]
    await this.#deleteByPattern(patterns)
  }

  /** 作废所有面板登录会话和二级密码解锁凭证 */
  async clearSessions() {
    await this.#deleteByPattern([
      `${Constant.REDIS_PREFIX}access-token:*`,
      `${Constant.REDIS_PREFIX}gate-token:*`,
    ])
  }

  async #deleteByPattern(patterns) {
    for (const pattern of patterns) {
      try {
        const keys = await redis.keys?.(pattern)
        if (Array.isArray(keys) && keys.length) {
          await Promise.all(keys.map(key => redis.del(key)))
        }
      } catch {
        // 老宿主可能没有 keys，清不掉也不影响冻结 / 解冻本身
      }
    }
  }

  /** 冻结时私聊通知主人 */
  #notify(info) {
    try {
      const now = new Date(info.at)
      const pad = (value) => String(value).padStart(2, '0')
      const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
        + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      const lines = [
        `[锅巴面板] 已冻结：${info.reason}`,
        `时间：${time}`,
        `来源 IP：${info.ip || '未知'}`,
      ]
      if (info.ua) lines.push(`设备：${info.ua}`)
      lines.push('解除：私聊机器人发送 #锅巴解冻（不会自动解除）')
      const message = lines.join('\n')
      const target = cfg.get('auth.securityMaster')
      // 指定了安全通知接收人时只发给他，发送失败也不改发其他主人
      Promise.resolve(target
        ? sendToMasterUser(message, target)
        : sendToOneMaster(message)).catch(() => {})
    } catch (error) {
      // 通知失败只记日志，不能影响冻结本身
      logger.error('[Guoba] 冻结通知发送失败')
      logger.error(error)
    }
  }
}
