import crypto from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { autowired, Service, GuobaError } from '#guoba.framework'
import { _paths, cfg, Constant } from '#guoba.platform'
import { getRealMasterList, randomString, sendToMasterUser, sendToOneMaster } from '#guoba.utils'
import { getClientIp, normalizeClientIp } from '../../utils/clientIp.js'
import { hashPassword, validatePassword, validateUsername, verifyPassword } from '../../utils/passwordHash.js'

export class LoginSecurityService extends Service {

  accessFreezeService = autowired('accessFreezeService')

  get auth() {
    const auth = cfg.get('auth')
    return auth && typeof auth === 'object' ? auth : {}
  }

  get configured() {
    return validateUsername(this.auth.username) && typeof this.auth.passwordHash === 'string' && this.auth.passwordHash.length > 0
  }

  getTrustedIpRecords() {
    const raw = this.auth.trustedIps
    if (!Array.isArray(raw)) return []
    return raw.map(item => {
      if (typeof item === 'string') {
        const ip = normalizeClientIp(item)
        return ip ? {ip} : null
      }
      if (item && typeof item.ip === 'string') {
        const ip = normalizeClientIp(item.ip)
        return ip ? {ip, device: item.device || undefined} : null
      }
      return null
    }).filter(Boolean)
  }

  // 向后兼容：仍可获取纯 IP 字符串列表
  getTrustedIps() {
    return this.getTrustedIpRecords().map(r => r.ip)
  }

  isTrusted(ip) {
    return !!ip && this.getTrustedIpRecords().some(r => r.ip === ip)
  }

  getStatus(req) {
    const ip = getClientIp(req)
    const device = this.verifyDevice(req)
    return {
      configured: this.configured,
      // IP 认得出、或者浏览器里那份设备凭证还有效，都不用再走验证码
      captchaRequired: this.configured ? !this.isTrusted(ip) && !device : false,
      ip: ip || '未知',
      deviceTrusted: !!device,
    }
  }

  async setCredentials(username, password, currentPassword = '', req = null) {
    username = typeof username === 'string' ? username.trim() : ''
    if (!validateUsername(username)) throw new GuobaError('用户名长度必须为1至64位')
    if (!validatePassword(password)) throw new GuobaError('密码须为8至128位')
    // 已配置时改密码必须验证当前密码，失败同样计入连错次数
    const wasConfigured = this.configured
    if (wasConfigured) {
      await this.verifyPasswordForSensitiveAction(req, currentPassword)
    }
    cfg.set('auth.username', username)
    cfg.set('auth.passwordHash', hashPassword(password))
    if (!Array.isArray(cfg.get('auth.trustedIps'))) cfg.set('auth.trustedIps', [])
    if (!Array.isArray(cfg.get('auth.trustedDevices'))) cfg.set('auth.trustedDevices', [])
    // 设置凭证的人就是本人，直接信任当前IP和当前浏览器，退出后重新登录无需再走验证码
    const ip = req ? getClientIp(req) : ''
    const ua = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : ''
    let device
    if (req) {
      this.addTrustedIp(ip, ua)
      device = this.issueDevice(req, this.verifyDevice(req, false))
    }
    // 改面板密码是最敏感的操作之一，必须留痕并通知主人（以前这一步悄无声息）
    const isFirst = !wasConfigured
    this.#audit(isFirst ? 'credentials-init' : 'credentials-change', {
      username, ip, ua: ua.slice(0, 200),
    })
    this.#notifyOwner([
      `[锅巴面板] ${isFirst ? '面板已完成初始化配置' : '登录账号密码已被修改'}。`,
      `时间：${this.#nowText()}`,
      `用户名：${username}`,
      `来源 IP：${ip || '未知'}`,
      ...(ua ? [`设备：${ua.length > 160 ? ua.slice(0, 160) + '…' : ua}`] : []),
      '若不是你本人操作，请立即在面板里重置密码，并检查可信设备与可信 IP。',
    ])
    return {configured: true, username, device}
  }

  /** 当前时间文本 */
  #nowText() {
    const now = new Date()
    const pad = (v) => String(v).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
      + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  }

  /**
   * 安全事件审计。
   *
   * 先落盘：私聊通知会因 Bot 离线、非好友、超时而丢，但磁盘不会。
   * 位置 data/guoba/security-audit.log，一行一个 JSON。
   */
  #audit(event, detail = {}) {
    try {
      const dir = path.join(_paths.data, 'guoba')
      fs.mkdirSync(dir, { recursive: true })
      const line = JSON.stringify({ time: this.#nowText(), event, ...detail })
      fs.appendFileSync(path.join(dir, 'security-audit.log'), line + '\n')
    } catch (error) {
      logger.error('[Guoba] 安全审计日志写入失败')
      logger.error(error)
    }
    logger.mark(`[Guoba][安全] ${event}`)
  }

  /** 把安全事件私聊给主人；没送达必须留下痕迹，而不是静默吞掉 */
  #notifyOwner(lines) {
    try {
      const list = Array.isArray(lines) ? lines : [String(lines)]
      const message = list.join('\n')
      const target = cfg.get('auth.securityMaster')
      const send = target ? sendToMasterUser(message, target) : sendToOneMaster(message)
      Promise.resolve(send)
        .then((count) => {
          if (!count) {
            logger.error(`[Guoba] 安全通知未能送达主人(${target || '默认'}），已写入审计日志`)
            this.#audit('notify-failed', { target: target || '' })
          }
        })
        .catch((error) => {
          logger.error('[Guoba] 安全通知发送异常')
          logger.error(error)
          this.#audit('notify-error', { message: String(error?.message || error) })
        })
    } catch (error) {
      logger.error('[Guoba] 安全通知发送失败')
      logger.error(error)
    }
  }

  /** 主人在聊天里发起的账号重置：账号、密码、二级密码一起清空，回到初始化登录流程 */
  resetCredentials() {
    this.#audit('credentials-reset-by-owner', {})
    cfg.set('auth.username', '')
    cfg.set('auth.passwordHash', '')
    // 登录凭证都重置了，二级密码一起清掉；否则验证码登录后会被二级密码
    // 挡在设置页外面，形成死锁
    cfg.set('auth.gatePasswordHash', '')
    cfg.set('auth.trustedIps', [])
    cfg.set('auth.trustedDevices', [])
    // 连密码错误的计数一起清掉
    this.#clearPasswordAttempts()
    // 所有面板登录会话和二级密码解锁凭证作废
    try {
      Promise.resolve(this.accessFreezeService.clearSessions()).catch(() => {})
    } catch {
      // 清理失败不影响重置本身
    }
  }

  /** 清掉所有 IP 的密码失败计数 */
  #clearPasswordAttempts() {
    const pattern = `${Constant.REDIS_PREFIX}login-captcha:*:password-*`
    try {
      Promise.resolve(redis.keys?.(pattern))
        .then(keys => Promise.all((keys || []).map(key => redis.del(key))))
        .catch(() => {})
    } catch {
      // 老宿主可能没有 keys，清不掉也不影响重置本身
    }
  }

  captchaKey(ip) {
    const digest = crypto.createHash('sha256').update(ip).digest('hex')
    return `${Constant.REDIS_PREFIX}login-captcha:${digest}`
  }

  cooldownKey(ip) {
    return `${this.captchaKey(ip)}:cooldown`
  }

  attemptsKey(ip) {
    return `${this.captchaKey(ip)}:attempts`
  }

  passwordAttemptsKey(ip) {
    return `${this.captchaKey(ip)}:password-attempts`
  }

  globalCaptchaKey() {
    return `${Constant.REDIS_PREFIX}login-captcha:global`
  }

  async requestCaptcha(req, loginService) {
    const ip = getClientIp(req)
    if (!ip) throw new GuobaError('无法识别访问来源')
    if (this.isTrusted(ip)) throw new GuobaError('当前IP无需验证码')
    const locked = await redis.get(this.attemptsKey(ip))
    if (locked === 'locked') throw new GuobaError('验证码尝试次数过多，请稍后再试')
    const globalCount = await redis.incr(this.globalCaptchaKey())
    if (globalCount === 1) await redis.expire(this.globalCaptchaKey(), Constant.LOGIN_CAPTCHA_COOLDOWN)
    if (globalCount > Constant.LOGIN_CAPTCHA_GLOBAL_LIMIT) {
      throw new GuobaError('验证码请求过于频繁，请稍后再试')
    }
    const cooldown = await redis.set(this.cooldownKey(ip), '1', {NX: true, EX: Constant.LOGIN_CAPTCHA_COOLDOWN})
    if (!cooldown) throw new GuobaError('验证码请求过于频繁，请稍后再试')
    const code = randomString(16)
    const digest = crypto.createHash('sha256').update(code).digest('hex')
    await redis.set(this.captchaKey(ip), digest, {EX: Constant.LOGIN_CAPTCHA_TTL})
    const count = await loginService.sendCodeToMaster(code)
    if (count <= 0) {
      await redis.del(this.captchaKey(ip), this.cooldownKey(ip))
      throw new GuobaError('验证码未能私聊发送给主人，请检查主人账号和 Bot 私聊状态')
    }
    return {pushed: count, expire: Constant.LOGIN_CAPTCHA_TTL}
  }

  async checkCaptcha(ip, code) {
    const key = this.captchaKey(ip)
    const expected = await redis.get(key)
    if (!expected || typeof code !== 'string' || !code) return false
    const actual = crypto.createHash('sha256').update(code.trim()).digest('hex')
    if (crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      await redis.del(key, this.attemptsKey(ip))
      return true
    }
    const attempts = await redis.incr(this.attemptsKey(ip))
    if (attempts >= Constant.LOGIN_CAPTCHA_MAX_ATTEMPTS) {
      await redis.set(this.attemptsKey(ip), 'locked', {EX: Constant.LOGIN_CAPTCHA_LOCK_TTL})
    } else {
      await redis.expire(this.attemptsKey(ip), Constant.LOGIN_CAPTCHA_LOCK_TTL)
    }
    return false
  }

  async addTrustedIp(ip, device) {
    ip = normalizeClientIp(ip)
    if (!ip) return
    const records = this.getTrustedIpRecords()
    if (!records.some(r => r.ip === ip)) {
      const entry = {ip}
      if (device) entry.device = String(device).slice(0, 200)
      cfg.set('auth.trustedIps', [...records, entry])
    }
  }

  /* ---------------- 可信设备 ---------------- */

  /**
   * 请求头里带的设备信息。
   *
   * id/secret 是浏览器 localStorage 里存的长期凭证，跟 IP 无关；
   * fp/info 是浏览器指纹，**只用来展示和事后审计**，不参与放行判定
   * —— 浏览器升级、改缩放、换显示器都会让它变，客户端也能随便伪造。
   */
  readDeviceHeaders(req) {
    const pick = (key) => {
      const v = req?.headers?.[key]
      return typeof v === 'string' ? v.trim() : ''
    }
    // header 只认 latin1，中文摘要由前端 encodeURIComponent 过
    let info = pick(Constant.DEVICE_INFO_HEADER)
    if (info) {
      try {
        info = decodeURIComponent(info)
      } catch {
        // 编码坏了就当没有，别影响登录
      }
    }
    return {
      id: pick(Constant.DEVICE_ID_HEADER).slice(0, 64),
      secret: pick(Constant.DEVICE_SECRET_HEADER).slice(0, 128),
      fp: pick(Constant.DEVICE_FP_HEADER).slice(0, 64),
      info: info.slice(0, 200),
      ua: typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 200) : '',
    }
  }

  getTrustedDevices() {
    const raw = this.auth.trustedDevices
    if (!Array.isArray(raw)) return []
    return raw
      .map(item => {
        if (!item || typeof item.id !== 'string' || typeof item.secretHash !== 'string') return null
        if (!item.id || !item.secretHash) return null
        return {
          id: item.id,
          secretHash: item.secretHash,
          name: typeof item.name === 'string' ? item.name : '',
          fp: typeof item.fp === 'string' ? item.fp : '',
          ua: typeof item.ua === 'string' ? item.ua : '',
          ip: typeof item.ip === 'string' ? item.ip : '',
          createdAt: Number(item.createdAt) || 0,
          lastAt: Number(item.lastAt) || 0,
        }
      })
      .filter(Boolean)
  }

  #hashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex')
  }

  #sameHash(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  }

  #saveDevices(list) {
    // 只留最近用过的若干台，按最后使用时间淘汰
    const kept = [...list]
      .sort((a, b) => (b.lastAt || b.createdAt) - (a.lastAt || a.createdAt))
      .slice(0, Constant.TRUSTED_DEVICE_MAX)
    cfg.set('auth.trustedDevices', kept)
  }

  /**
   * 校验浏览器带来的设备凭证。
   * @param req 请求
   * @param touch 命中后是否更新最后使用时间（带写盘节流）
   * @return 命中的记录，没命中返回 null
   */
  verifyDevice(req, touch = true) {
    const {id, secret, fp, info, ua} = this.readDeviceHeaders(req)
    if (!id || !secret) return null
    const devices = this.getTrustedDevices()
    const hit = devices.find(d => d.id === id && this.#sameHash(d.secretHash, this.#hashSecret(secret)))
    if (!hit) return null
    const now = Date.now()
    // 过期就地清掉，免得配置里堆一堆早就不用的
    if (hit.lastAt && now - hit.lastAt > Constant.TRUSTED_DEVICE_TTL * 1000) {
      this.#saveDevices(devices.filter(d => d.id !== id))
      return null
    }
    if (touch && now - (hit.lastAt || 0) > Constant.TRUSTED_DEVICE_TOUCH_GAP) {
      hit.lastAt = now
      // 指纹/UA/IP 变了也照原样记下来，只为了让人在面板上看出是哪台、有没有异常
      if (fp) hit.fp = fp
      if (info) hit.name = info
      if (ua) hit.ua = ua
      const ip = normalizeClientIp(getClientIp(req))
      if (ip) hit.ip = ip
      this.#saveDevices(devices.map(d => (d.id === id ? hit : d)))
    }
    return hit
  }

  /**
   * 签发（或轮换）设备凭证。
   *
   * 每次登录成功都换一份新 secret：万一旧的被人抄走了，也只能用到下一次登录为止。
   * @return {{id: string, secret: string}} 明文凭证，只在这一次响应里给出去
   */
  issueDevice(req, existing = null) {
    const {id, fp, info, ua} = this.readDeviceHeaders(req)
    const now = Date.now()
    // 这是长期凭证，随机数得是密码学安全的，不能用 randomString（底层是 Math.random）
    const deviceId = existing?.id || id || crypto.randomBytes(12).toString('hex')
    const secret = crypto.randomBytes(32).toString('hex')
    const ip = normalizeClientIp(getClientIp(req)) || ''
    const record = {
      id: deviceId,
      secretHash: this.#hashSecret(secret),
      name: info || ua || '未知设备',
      fp,
      ua,
      ip,
      createdAt: existing?.createdAt || now,
      lastAt: now,
    }
    this.#saveDevices([...this.getTrustedDevices().filter(d => d.id !== deviceId), record])
    return {id: deviceId, secret}
  }

  revokeDevice(id) {
    const target = typeof id === 'string' ? id : ''
    this.#saveDevices(this.getTrustedDevices().filter(d => d.id !== target))
    return this.getSecurity()
  }

  clearDevices() {
    cfg.set('auth.trustedDevices', [])
    return this.getSecurity()
  }

  /**
   * 敏感操作（比如忘记二级密码时的重置）验证登录密码。
   * 失败同样计入登录密码错误次数，连错 3 次会冻结整个面板。
   */
  async verifyPasswordForSensitiveAction(req, password) {
    const ip = getClientIp(req)
    if (!ip) throw new GuobaError('无法识别访问来源')
    const passwordKey = this.passwordAttemptsKey(ip)
    if (verifyPassword(password, this.auth.passwordHash)) {
      await redis.del(passwordKey)
      return true
    }
    const attempts = await redis.incr(passwordKey)
    if (attempts >= Constant.LOGIN_PASSWORD_MAX_ATTEMPTS) {
      await redis.del(passwordKey)
      await this.handleTooManyPasswordFailures(req)
    }
    await redis.expire(passwordKey, Constant.LOGIN_PASSWORD_ATTEMPT_WINDOW)
    throw new GuobaError('登录密码错误')
  }

  /**
   * 登录密码连续输错 3 次：永久冻结整个面板，只有主人能在聊天里解冻。
   *
   * 不设过期时间：带 TTL 的冻结只是把攻击节奏从「每秒一次」改成「每 15 分钟三次」，
   * 挡住的是手速，挡不住耐心。
   * 也不重置凭证 —— 重置会把面板打回「未初始化」，等于给陌生人一个接管入口。
   */
  async handleTooManyPasswordFailures(req) {
    const ip = getClientIp(req)
    const ua = typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : ''
    // 连错密码绝不重置凭证：重置等于给陌生人一个「把面板打回未初始化」的按钮。
    // 直接冻结整个面板（含登录入口和端口闸门），只有主人能在聊天里解冻。
    this.#audit('login-frozen', { ip: ip || '', ua: ua.slice(0, 200) })
    try {
      // 不传有效期 = 永久冻结。给冻结加 TTL 等于告诉攻击者「等 15 分钟再来」，
      // 每过一轮又能试 3 次，冻了跟没冻一样。机器人下线也能再上线，
      // 解冻指令永远有到达的那天，所以这里就该一直锁着。
      await this.accessFreezeService.freeze('登录密码连续输错 3 次', { ip, ua })
    } catch (error) {
      logger.error('[Guoba] 冻结面板失败')
      logger.error(error)
    }
    if (ip) await redis.del(this.passwordAttemptsKey(ip))
    const error = new GuobaError('登录密码错误次数过多，面板已冻结。请主人私聊机器人发送「#锅巴解冻」后重试')
    error.frozen = true
    throw error
  }

  async login(req, body, loginService) {

    const ip = getClientIp(req)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = body?.password
    const captcha = body?.captcha
    if (!ip) throw new GuobaError('无法识别访问来源')
    if (!this.configured) throw new GuobaError('请先由主人配置登录账号和密码')
    const passwordKey = this.passwordAttemptsKey(ip)
    if (!validateUsername(username) || !validatePassword(password)
      || username !== this.auth.username || !verifyPassword(password, this.auth.passwordHash)) {
      const attempts = await redis.incr(passwordKey)
      if (attempts >= Constant.LOGIN_PASSWORD_MAX_ATTEMPTS) {
        // 连续错 3 次：冻结面板，只有主人能在聊天里解冻
        await redis.del(passwordKey)
        await this.handleTooManyPasswordFailures(req)
      }
      await redis.expire(passwordKey, Constant.LOGIN_PASSWORD_ATTEMPT_WINDOW)
      throw new GuobaError('用户名或密码错误')
    }
    await redis.del(passwordKey)
    // 设备凭证有效就跳过验证码 —— IP 会漂，浏览器里那份不会
    const known = this.verifyDevice(req, false)
    if (!this.isTrusted(ip) && !known) {
      if (!await this.checkCaptcha(ip, captcha)) {
        const status = captcha ? '验证码错误或已失效' : '请先获取并输入验证码'
        if (!captcha) return {captchaRequired: true, error: status}
        throw new GuobaError(status)
      }
      const device = typeof req.headers?.['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined
      await this.addTrustedIp(ip, device)
    }
    // 每次登录都换一份新的设备凭证，前端存下来，下次换了IP也不用验证码
    return {token: loginService.signToken(username), device: this.issueDevice(req, known)}
  }

  getSecurity() {
    return {
      configured: this.configured,
      username: this.configured ? this.auth.username : '',
      securityMaster: typeof this.auth.securityMaster === 'string' ? this.auth.securityMaster : '',
      trustedIps: this.getTrustedIpRecords(),
      // 不返回 secretHash，面板上只需要看得出是哪台、什么时候用过
      trustedDevices: this.getTrustedDevices().map(({secretHash, ...rest}) => rest),
    }
  }

  /** 主人列表（去重）：给「安全通知接收人」下拉框用 */
  async listMasters() {
    const seen = new Set()
    const list = []
    for (const {userId, botId} of await getRealMasterList()) {
      const id = String(userId)
      if (seen.has(id)) continue
      seen.add(id)
      list.push({userId: id, botId: botId == null ? null : String(botId)})
    }
    return list
  }

  /**
   * 设置安全通知接收人。
   * 冻结、登录失败重置、二级密码输错的通知只发给他，验证码也只发给他，
   * #锅巴解冻 / #锅巴重置账号 也只接受他。
   */
  async setSecurityMaster(currentPassword, userId, req) {
    await this.verifyPasswordForSensitiveAction(req, currentPassword)
    const target = String(userId ?? '').trim()
    if (target) {
      const masters = await getRealMasterList()
      if (!masters.some(m => String(m.userId) === target)) {
        throw new GuobaError('该账号不在主人列表中')
      }
    }
    cfg.set('auth.securityMaster', target)
    return this.getSecurity()
  }

  revokeIp(ip) {
    const target = normalizeClientIp(ip)
    cfg.set('auth.trustedIps', this.getTrustedIpRecords().filter(r => r.ip !== target))
    return this.getSecurity()
  }

  clearIps() {
    cfg.set('auth.trustedIps', [])
    return this.getSecurity()
  }
}
