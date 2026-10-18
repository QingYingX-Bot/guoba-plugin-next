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

  async status() {
    const info = await this.accessFreezeService.getInfo()
    return Result.ok({
      frozen: !!info,
      reason: info?.reason || '',
      at: info?.at || 0,
    })
  }
}
