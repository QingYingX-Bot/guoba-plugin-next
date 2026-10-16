import {autowired, Result} from '#guoba.framework'
import {ApiController} from '#guoba.platform'

/**
 * 消息记录。
 *
 * 与沙盒相反，这里是真收真发：消息取自适配器与 QQ 服务端，发出去的会真的到群里。
 */
export class ChatController extends ApiController {

  chatService = autowired('chatService')

  constructor(guobaApp) {
    super('/chat', guobaApp)
  }

  registerRouters() {
    this.get('/status', this.status)
    this.get('/sessions', this.sessions)
    this.get('/history', this.history)
    this.get('/tail', this.tail)
    this.get('/raw', this.raw)
    this.post('/send', this.send)
    this.post('/send-raw', this.sendRaw)
    this.post('/recall', this.recall)
    this.post('/resend', this.resend)
    this.post('/poke', this.poke)
    this.post('/read', this.read)
    this.post('/forward', this.forward)
    this.get('/group-info', this.groupInfo)
    this.get('/user-info', this.userInfo)
    this.post('/refresh-group', this.refreshGroup)
    this.post('/pin', this.pin)
    this.post('/blacklist', this.blacklist)
    this.post('/note', this.note)
    // 下面两个要能直接写进 <img src>，token 走 query（TokenInterceptor 支持）
    this.get('/asset/:id', this.getAsset)
    this.get('/proxy', this.proxy)
  }

  /** 缓冲状态，前端显示「内存里留了多少条」 */
  async status() {
    return Result.ok(this.chatService.status())
  }

  /** 会话列表（群 / 好友），带最后一条摘要与未读数 */
  async sessions(req) {
    const {type, botId, keyword, pageNo, pageSize} = req.query ?? {}
    return Result.ok(await this.chatService.listSessions({type, botId, keyword, pageNo, pageSize}))
  }

  /** 拉历史消息，seq 为向上翻页的游标 */
  async history(req) {
    const {botId, type, id, seq, count} = req.query ?? {}
    return Result.ok(await this.chatService.getHistory({botId, type, id, seq, count}))
  }

  /** 实时增量，cursor + key */
  async tail(req) {
    const {key, cursor, rev} = req.query ?? {}
    return Result.ok(this.chatService.tail({key, cursor, rev}))
  }

  /** 一条消息的原始数据，四档：段数组 / 上报原文 / pb 元素 / pb 原文 */
  async raw(req) {
    const {botId, type, id, messageId} = req.query ?? {}
    return Result.ok(await this.chatService.getRaw({botId, type, id, messageId}))
  }

  /** 发消息，会真的发到 QQ 上。文件走 multipart（锅巴全局挂的 multer 已把文件放进 req.files） */
  async send(req) {
    const {botId, type, id, text, images, replyTo, replyMsgId, replyEventId, ats, kind, ark} = req.body ?? {}
    return Result.ok(await this.chatService.send({
      botId, type, id, text, images, replyTo, replyMsgId, replyEventId, ats, kind, ark,
      files: req.files,
    }))
  }

  /** 发原始消息段数组 */
  async sendRaw(req) {
    const {botId, type, id, raw} = req.body ?? {}
    return Result.ok(await this.chatService.sendRaw({botId, type, id, raw}))
  }

  /** 撤回，只能撤 bot 自己发的且有时限 */
  async recall(req) {
    const {botId, type, id, messageId} = req.body ?? {}
    return Result.ok(await this.chatService.recall({botId, type, id, messageId}))
  }

  /** 复读：把内存里那条消息按段原样再发（图片取回字节、表情带 id） */
  async resend(req) {
    const {botId, type, id, messageId} = req.body ?? {}
    return Result.ok(await this.chatService.resend({botId, type, id, messageId}))
  }

  /** 戳一戳，群里是 pokeMember、私聊是 poke */
  async poke(req) {
    const {botId, type, id, userId} = req.body ?? {}
    return Result.ok(await this.chatService.poke({botId, type, id, userId}))
  }

  /** 清掉某个会话的未读 */
  async read(req) {
    const {key} = req.body ?? {}
    return Result.ok(this.chatService.markRead(key))
  }

  /** 展开合并转发，内容在 QQ 服务端，点开时才去取 */
  async forward(req) {
    const {botId, type, id, messageId} = req.body ?? {}
    return Result.ok(await this.chatService.getForward({botId, type, id, messageId}))
  }

  /** 群信息：面板记录 + 适配器现取，见 ChatService.groupInfo */
  async groupInfo(req) {
    const {botId, id, refresh} = req.query ?? {}
    return Result.ok(await this.chatService.groupInfo({
      botId, id, refresh: refresh === '1' || refresh === 'true',
    }))
  }

  /** 刷新群信息：跟 /group-info 同一份数据，只是强制问一次适配器 */
  async refreshGroup(req) {
    const {botId, id} = req.body ?? {}
    return Result.ok(await this.chatService.refreshGroupInfo({botId, id}))
  }

  /** 用户信息：私聊点头像弹的那张卡，见 ChatService.userInfo */
  async userInfo(req) {
    const {botId, id, refresh} = req.query ?? {}
    return Result.ok(await this.chatService.userInfo({
      botId, id, refresh: refresh === '1' || refresh === 'true',
    }))
  }

  /** 置顶 / 取消置顶（纯面板状态） */
  async pin(req) {
    const {botId, type, id, pinned} = req.body ?? {}
    return Result.ok(this.chatService.setPin({botId, type, id, pinned: pinned !== false}))
  }

  /** 拉黑 / 取消拉黑群聊 */
  async blacklist(req) {
    const {botId, type, id, blacklisted} = req.body ?? {}
    return Result.ok(await this.chatService.setBlacklist({
      botId, type, id, blacklisted: blacklisted !== false,
    }))
  }

  /**
   * 设置 / 清除群备注（纯面板状态，用户自己给群起的名字）。
   *
   * 传空串就是清除 —— 所以这里**不能**用 `note || ''` 之外的兜底逻辑把空值吞掉。
   */
  async note(req) {
    const {botId, id, note} = req.body ?? {}
    return Result.ok(this.chatService.setGroupNote({botId, id, note}))
  }

  /** 回传自己发出去的那张图 */
  async getAsset(req, res) {
    const asset = this.chatService.getAsset(req.params.id)
    res.type(asset.mime)
    // 资源 id 是内容哈希，同一 URL 内容不变，可以放心缓存
    res.set('Cache-Control', 'private, max-age=1800, immutable')
    res.send(asset.buffer)
    return Result.VOID
  }

  /** QQ 直链的 rkey 过期后由服务端代拉一次，只放行消息里出现过的地址 */
  async proxy(req, res) {
    const {buffer, mime} = await this.chatService.proxy(req.query?.url)
    res.type(mime)
    // rkey 会过期，别缓存太久
    res.set('Cache-Control', 'private, max-age=300')
    res.send(buffer)
    return Result.VOID
  }

}
