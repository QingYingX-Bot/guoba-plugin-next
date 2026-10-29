import {autowired, Result} from '#guoba.framework'
import {ApiController} from '#guoba.platform'

/**
 * 媒体票据签发。
 *
 * 只服务于「浏览器按 URL 直连」的资源（备份下载、消息图片）：
 * URL 里放短期票据，不再放正式登录令牌。
 */
export default class MediaTicketController extends ApiController {

  mediaTicketService = autowired('mediaTicketService')

  constructor(guobaApp) {
    super('/media-ticket', guobaApp)
  }

  registerRouters() {
    this.post('/', this.create)
  }

  async create(req) {
    const scope = ['backup', 'chat', 'file'].includes(req.body?.scope) ? req.body.scope : 'chat'
    return Result.ok(await this.mediaTicketService.issue(req, scope))
  }
}
