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
    redis.set(redisKey, token, {EX: 3600 * 24})
    return token
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
