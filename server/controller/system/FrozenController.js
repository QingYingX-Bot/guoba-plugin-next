import { autowired, Result } from '#guoba.framework'
import { ApiController } from '#guoba.platform'

/**
 * 冻结状态查询。
 *
 * 唯一不需要登录态的接口：面板冻结时前端要靠它显示冻结页、并轮询是否已经解冻。
 * 只返回冻结与否和原因，不泄露任何账号信息。
 */
export class FrozenController extends ApiController {

  accessFreezeService = autowired('accessFreezeService')

  constructor(guobaApp) {
    super('/frozen', guobaApp)
  }

  registerRouters() {
    this.get('/status', this.status)
  }

  async status(req) {
    const info = await this.accessFreezeService.getInfo()
    // 只关外网时，局域网看到的就是「没冻结」，冻结页会自动跳回去
    const blocked = this.accessFreezeService.isBlocked(info, req)
    return Result.ok({
      frozen: blocked,
      reason: blocked ? info?.reason || '' : '',
      at: blocked ? info?.at || 0 : 0,
    })
  }
}
