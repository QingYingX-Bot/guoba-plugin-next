import jwt from 'jsonwebtoken'
import {GuobaError, Service} from '#guoba.framework';
import {cfg, Constant} from "#guoba.platform";
import {getAllWebAddress, randomString, sendToOneMaster} from '#guoba.utils'

export class LoginService extends Service {
  constructor(app) {
    super(app)
  }

  /** 注册并保存Token */
  signToken(username) {
    let token = jwt.sign({username}, cfg.getJwtSecret())
    // 将token存入redis
    let redisKey = this.getRedisKey(token)
    redis.set(redisKey, token, {EX: Constant.TOKEN_TTL})
    return token
  }

  /**
   * 令牌滑动续期。
   *
   * 只要面板还在用（任何带令牌的请求），就把这条 key 的寿命往后顺延，
   * 做到「一直在用就一直不掉线」。剩余寿命还够时直接返回，不写 redis。
   * 续期失败只记日志，不影响本次请求 —— 下次请求还会再试。
   */
  async renewToken(token) {
    if (!token) return
    let redisKey = this.getRedisKey(token)
    try {
      // ttl 是能力探测：个别宿主的 redis 客户端（或内存降级实现）未必实现它，
      // 拿不到就退化成「每次都续」，宁可多写一次也不能漏续。
      if (typeof redis.ttl === 'function') {
        let ttl = await redis.ttl(redisKey)
        // -2：key 不存在（本来也进不到这里）；-1：key 没有过期时间，都不用管
        if (ttl < 0) return
        if (ttl > Constant.TOKEN_RENEW_GAP) return
      }
      if (typeof redis.expire === 'function') {
        await redis.expire(redisKey, Constant.TOKEN_TTL)
      } else {
        // 兜底：重写一遍 value 顺带把 EX 带上
        await redis.set(redisKey, token, {EX: Constant.TOKEN_TTL})
      }
    } catch (err) {
      logger.error('[Guoba] 登录令牌续期失败')
      logger.error(err)
    }
  }

  logout(token) {
    if (token) {
      let redisKey = this.getRedisKey(token)
      redis.del(redisKey)
    }
  }

  /** 仅获取面板地址，不签发任何令牌（已启用账号密码登录时用） */
  async getWebAddress() {
    return getAllWebAddress()
  }

  async codeLoginRequest() {
    let redisKey = `${Constant.REDIS_PREFIX}login-code`
    let code = await redis.get(redisKey)
    if (code) {
      throw new GuobaError('当前验证码还未失效，请稍后再试')
    } else {
      code = randomString(16)
    }
    await redis.set(redisKey, code, {EX: 300})
    return code
  }

  /**
   * 把登录验证码私聊发给主人。
   *
   * 只发给触发者本人：优先发给最近在聊天里请求过登录的那个人（见 apps/login.js
   * 里的记录），拿不到记录才退回发给第一个真实主人。绝不广播给所有主人，
   * 否则群里每个管理员都会收到别人的验证码。
   *
   * 文案与验证码分成两条，方便手机端长按复制。
   * @return {Promise<number>} 收到消息的主人数量（0 或 1）
   */
  async sendCodeToMaster(code) {
    try {
      const target = await this.getLoginRequester()
      const count = await sendToOneMaster([
        '[锅巴面板] 您正在请求验证码登录，验证码五分钟内有效：',
        code,
        '若非本人操作请忽略，并检查登录地址是否泄露。',
      ], target)
      return count > 0 ? 1 : 0
    } catch (err) {
      logger.error('[Guoba] 验证码私发主人失败')
      logger.error(err)
      return 0
    }
  }

  /** 最近一次在聊天里请求登录的主人（#锅巴登录），用于把验证码只发给他本人 */
  async getLoginRequester() {
    try {
      const raw = await redis.get(`${Constant.REDIS_PREFIX}login-requester`)
      if (!raw) return null
      const data = JSON.parse(raw)
      return data?.userId ? {botId: data.botId ?? null, userId: data.userId} : null
    } catch {
      // 缓存读坏了就当没有，退回默认主人
      return null
    }
  }

  async codeLoginCheck(code) {
    if (!code || typeof code !== 'string') {
      return false
    }
    let redisKey = `${Constant.REDIS_PREFIX}login-code`
    let redisCode = await redis.get(redisKey)
    if (!redisCode) {
      return false
    }
    if (redisCode === code) {
      await redis.del(redisKey)
      return await this.signToken('admin')
    }
    return false
  }

  getRedisKey(token) {
    return `${Constant.REDIS_PREFIX}access-token:${token}`
  }
}
