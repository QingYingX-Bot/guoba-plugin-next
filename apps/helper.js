import {cfg} from "#guoba.platform";
import {getMasterBotIds, isFakeAccount, sendToBotMaster} from '#guoba.utils'

// 账号刚连上时好友列表等信息可能还没同步完，等一会儿再发。
// 部分协议端（如 SnowLuma 等 OneBot 端）首次给某个好友发私聊要先解析 uid、建 c2c 会话，
// 冷启动那会儿好友缓存没热，这一步会慢过桥接层的接口超时 —— 所以留足缓冲并配合重试。
const GUIDE_DELAY = 15000
// 引导发送失败后的重试：总共尝试 GUIDE_RETRY_TIMES 次，每次间隔 GUIDE_RETRY_DELAY
const GUIDE_RETRY_TIMES = 3
const GUIDE_RETRY_DELAY = 15000

const GUIDE_MESSAGE = [
  '欢迎使用锅巴插件~',
  '',
  '【#锅巴登录】获取管理面板地址',
  '首次登录还没有账号密码：打开登录页点“获取登录令牌”，令牌会私聊发给主人（五分钟内有效），',
  '登录后在“账号管理 - 登录安全”里设置用户名和密码。',
  '',
  '【#锅巴帮助】查看帮助文档',
  '【#锅巴版本】查看当前版本',
  '【#锅巴日志】把最近的运行日志渲染成图片（#锅巴日志30 指定条数、#锅巴错误日志 只看报错）',
  '【#锅巴更新日志】查看 Fork 建库以来的历史更新记录',
  '【#锅巴更新】手动更新锅巴，更新成功后会自动显示本次更新内容',
  '【#锅巴重启】重新加载锅巴服务',
  '【#锅巴重置密码】忘记密码时清空凭证，重新走初始化登录',
  '',
  '面板的“网页截图”里可以开启：群里发个网址就自动截图预览（默认关闭）',
].join('\n')

export class GuobaHelp extends plugin {

  constructor(e) {
    super({
      name: '锅巴帮助',
      dsc: '锅巴插件帮助',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#?锅巴(帮助|菜单|说明|功能|指令|命令|使用说明|help)$',
          fnc: 'getHelp',
          permission: 'master',
        },
        // 可通过`#锅巴重启`重载`guoba.support.js`
        {
          reg: '^#锅巴重启$',
          fnc: 'restart',
          permission: 'master',
        },
      ],
    })
  }

  async init() {
    // 引导用户进行配置
    this.firstGuide()

  }

  async getHelp() {
    let msg = [
      '锅巴帮助：\n' +
      'https://gitee.com/guoba-yunzai/guoba-plugin/wikis/Home'
    ]

    if(this.e?.platform) {
      msg.push('[请在后台查看地址]')
      for(const item of msg){
        console.log(item)
        this.e.reply(item)
      }
      return 
    }

    return this.e.reply(msg)
  }

  async restart() {
    if (Guoba && Guoba.reload) {
      await Guoba.reload()
      return this.e.reply('锅巴重启成功~')
    } else {
      return this.e.reply('锅巴服务没有启动，请查看控制台的启动报错')
    }
  }

  /**
   * 首次安装锅巴时的引导
   *
   * init() 在插件加载阶段执行，早于 Bot 上线，那会儿账号还没连上，直接发必然失败；
   * 而 guide 一旦置 false 就再也不会发，所以要等真实账号连上、并确认发送成功后再关标记。
   */
  async firstGuide() {
    if (!cfg.get('base.guide')) {
      return
    }
    // 插件被 #锅巴重启 重载时账号早就连上了，不会再有 connect 事件
    const online = await this.getRealBotId()
    if (online != null) {
      return this.sendGuide(online)
    }
    const onConnect = e => {
      const botId = e?.self_id
      if (isFakeAccount(botId)) {
        return
      }
      Bot.off('connect', onConnect)
      setTimeout(() => this.sendGuide(botId), GUIDE_DELAY)
    }
    Bot.on('connect', onConnect)
  }

  /**
   * 取一个能给主人发消息的已连账号。
   *
   * 优先挑 `master` 里配了主人的账号：官bot 除了正式账号还会注册一个沙盒账号
   * （QQBotSandbox），它名下查不到主人，挑中它引导就发不出去。
   */
  async getRealBotId() {
    const uins = (Array.isArray(Bot.uin) ? Bot.uin : [Bot.uin]).filter(i => !isFakeAccount(i))
    if (uins.length === 0) {
      return null
    }
    const owners = await getMasterBotIds()
    return uins.find(i => owners.has(String(i))) ?? uins[0]
  }

  async sendGuide(botId) {
    for (let attempt = 1; attempt <= GUIDE_RETRY_TIMES; attempt++) {
      // 每次发送前都确认：等待期间可能已经在面板里关掉了引导
      if (!cfg.get('base.guide')) {
        return
      }
      const success = await sendToBotMaster(botId, GUIDE_MESSAGE)
      if (success > 0) {
        cfg.set('base.guide', false)
        return
      }
      // 首次失败多半是协议端好友缓存没热 / c2c 会话没建，等一会儿会话就绪了再试
      if (attempt < GUIDE_RETRY_TIMES) {
        logger.mark(`[Guoba] 首次安装引导发送失败，${GUIDE_RETRY_DELAY / 1000}秒后重试（${attempt}/${GUIDE_RETRY_TIMES - 1}）`)
        await new Promise(resolve => setTimeout(resolve, GUIDE_RETRY_DELAY))
      }
    }
    // 多次都没发出去就留着标记，下次启动重试，免得引导直接丢失
    logger.warn('[Guoba] 首次安装引导多次发送失败，将在下次启动时重试')
  }

}
