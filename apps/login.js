import { autowired } from '#guoba.framework'
import { makeForwardMsg } from '#guoba.utils'
import { cfg, Constant } from '#guoba.platform'

export class GuobaLogin extends plugin {
  loginService = autowired('loginService')
  loginSecurityService = autowired('loginSecurityService')
  freezeService = autowired('accessFreezeService')

  constructor (e) {
    super({
      name: '锅巴登录',
      dsc: '锅巴快捷登录',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#?锅巴(登录|登陆)$',
          fnc: 'login'
        },
        {
          // 忘记账号或密码时由主人重置：账号、密码、二级密码、可信设备和IP一起清空
          reg: '^#?锅巴重置(登录|登陆|密码|账号)$',
          fnc: 'resetLogin'
        },
        {
          // 登录密码或二级密码连错 3 次会冻结整个面板，只有主人能解
          reg: '^#?锅巴解冻$',
          fnc: 'unfreeze'
        },
        {
          // 面板默认只让局域网访问，要从外网打开得由主人临时开
          reg: '^#?(开启|关闭)锅巴外网$',
          fnc: 'toggleWan'
        }
      ]
    }, e)
  }

  // autowired 是懒代理，锅巴服务端没启动成功时读它的任何属性都会抛 xxxService is not found
  replyServerFailed (err) {
    logger.error('[Guoba] 锅巴服务未就绪', err)
    return this.reply('锅巴服务启动失败，请发送“#锅巴帮助”。')
  }

  /**
   * 记下本次请求登录的主人身份，网页取验证码时只发给他本人。
   *
   * 网页那一步认不出是谁在操作，只能靠这里留个记录；没记录（比如直接打开
   * 网页登录）时服务端会退回发给第一个主人。记录失败不影响正常发地址。
   */
  async rememberRequester () {
    try {
      const key = `${Constant.REDIS_PREFIX}login-requester`
      const data = JSON.stringify({
        botId: this.e.self_id != null ? String(this.e.self_id) : null,
        userId: String(this.e.user_id),
      })
      await redis.set(key, data, { EX: Constant.LOGIN_REQUESTER_TTL })
    } catch (err) {
      logger.error('[Guoba] 记录登录请求者失败')
      logger.error(err)
    }
  }

  /** 配置了安全通知接收人时，解冻 / 重置只接受这个人 */
  isSecurityMaster () {
    const target = cfg.get('auth.securityMaster')
    if (!target) return true
    return String(this.e.user_id) === String(target)
  }

  async resetLogin () {
    // 只认私聊 + 配置的安全通知接收人，避免别的主人清空面板凭证
    if (!this.e.isMaster || !this.e.isPrivate || !this.isSecurityMaster()) return false
    let configured
    try {
      configured = this.loginSecurityService.configured
    } catch (err) {
      return this.replyServerFailed(err)
    }
    if (!configured) {
      return this.reply('当前尚未设置账号密码，无需重置。')
    }
    this.loginSecurityService.resetCredentials()
    return this.reply(
      '账号已重置，账号密码、二级密码、可信IP和可信设备已清空。\n'
      + '发送“#锅巴登录”获取登录地址，在登录页点“获取登录令牌”，'
      + '登录后重新设置账号密码和二级密码。'
    )
  }

  /** 解除面板冻结（二级密码连错 3 次引起） */
  async unfreeze () {
    // 只认私聊 + 配置的安全通知接收人，避免别的主人解冻
    if (!this.e.isMaster || !this.e.isPrivate || !this.isSecurityMaster()) return false
    let existed
    try {
      existed = await this.freezeService.unfreeze()
    } catch (err) {
      return this.replyServerFailed(err)
    }
    return this.reply(existed
      ? '锅巴已解冻，可以重新打开面板登录了。'
      : '锅巴当前没有被冻结。')
  }

  /**
   * 开关外网访问。
   *
   * 默认关着：面板只认局域网（同网段）来的请求。开的时候是把配置里的 lanOnly 关掉，
   * 立刻生效，不用重启。
   */
  async toggleWan () {
    if (!this.e.isMaster) return false
    const open = /开启/.test(this.e.msg)
    try {
      cfg.set('server.lanOnly', !open)
    } catch (err) {
      return this.replyServerFailed(err)
    }
    if (!open) {
      return this.reply('已关闭外网访问，现在只有局域网能打开面板。')
    }
    let address = ''
    try {
      address = await this.loginService.getWebAddress()
    } catch {
      // 拿不到地址不影响开关本身
    }
    return this.reply(address
      ? `已开启外网访问：${address}
用完发「#关闭锅巴外网」关掉。`
      : '已开启外网访问。用完发「#关闭锅巴外网」关掉。')
  }

  async login () {
    if (!this.e.isMaster) return false
    // 记下是谁请求的登录：网页点“获取登录令牌”时，验证码只私聊发给他本人
    await this.rememberRequester()

    let configured, webAddress
    try {
      configured = this.loginSecurityService.configured
      // 无论是否已配置账号，都只发面板地址，不签发任何免密令牌
      webAddress = await this.loginService.getWebAddress()
    } catch (err) {
      return this.replyServerFailed(err)
    }

    const onlyCustomAddress = cfg.get('base.onlyCustomAddress')
    const { custom, local, remote } = webAddress
    const message = configured
      ? ['这是锅巴面板的地址，请使用用户名密码登录：']
      : ['欢迎回来主人~\n这是您的登录地址：']

    // 文案与网址分条发送，方便手机端长按复制
    const pushAddress = (title, list) => {
      message.push(title)
      if (list.length > 0) {
        message.push(...list)
      } else {
        message.push('地址获取失败，请稍后重试')
      }
    }

    if (onlyCustomAddress) {
      if (custom && custom.length > 0) {
        pushAddress('自定义地址：', custom)
      } else {
        message.push('已开启“仅发送自定义地址”，但没填地址，请在锅巴面板的配置里补上。')
      }
    } else {
      if (custom && custom.length > 0) {
        pushAddress('自定义地址：', custom)
      }
      if (local) {
        pushAddress('内网地址：', local)
      }
      if (remote) {
        pushAddress('外网地址：', remote)
      }
    }

    if (configured) {
      message.push('忘记账号或密码可发送“#锅巴重置账号”。')
    } else {
      message.push(
        '还没设置账号密码。打开登录页点“获取登录令牌”（令牌私聊发给主人，五分钟内有效），\n'
        + '登录后在“账号管理 - 登录安全”里设置用户名和密码。'
      )
    }

    if (this.e?.platform) {
      message.push('[请在后台查看地址]')
      for (const item of message) {
        console.log(item)
        this.e.reply(item)
      }
      return
    }

    if (this.e.isGroup && !cfg.get('base.loginInGroup')) {
      try {
        await Bot.pickUser(this.e.user_id).sendMsg(
          await this.e.runtime.common.makeForwardMsg(this.e, message)
        )
        await this.reply(
          configured
            ? '当前已启用用户名密码登录，面板地址已私聊发送给主人~'
            : '地址已发送至主人的私信了~'
        )
      } catch (e) {
        logger.error(e)
        await this.reply('发送失败，请加 Bot 好友，或私聊发送“#锅巴登录”')
      }
    } else {
      if (configured) {
        await this.reply('当前已启用用户名密码登录，请使用以下地址打开面板：')
      }
      await this.reply(await makeForwardMsg(this.e, message))
    }
  }
}
