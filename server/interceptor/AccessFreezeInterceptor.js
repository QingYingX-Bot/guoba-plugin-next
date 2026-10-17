import { autowired, Interceptor, Result } from '#guoba.framework'
import { _paths, Constant } from '#guoba.platform'
import { setPortFrozen } from '../utils/freezePortGuard.js'

/**
 * 冻结拦截器。
 *
 * 优先级高于 TokenInterceptor：面板被冻结后，连登录接口也一并拒绝，
 * 只有公开的冻结状态查询（给冻结页轮询用）和静态资源放行。
 */
const EXCLUDE = [
  /^\/api\/frozen\/status$/,
]

export default class AccessFreezeInterceptor extends Interceptor {

  accessFreezeService = autowired('accessFreezeService')

  async handler(req, res, next) {
    const path = this.#relativePath(req)
    if (!path.startsWith('/api/')) {
      next()
      return
    }
    if (EXCLUDE.some(reg => reg.test(path))) {
      next()
      return
    }
    let info = null
    try {
      info = await this.accessFreezeService.getInfo()
    } catch (error) {
      // 状态读不出来时不拦，交给上层正常鉴权
      logger.error('[Guoba] 读取冻结状态失败')
      logger.error(error)
      next()
      return
    }
    if (!info) {
      next()
      return
    }
    // 进程内状态可能因热重载等原因落后于 redis，这里顺手对齐（只置 true，解除由 unfreeze 负责）
    setPortFrozen(true)
    const message = '锅巴已冻结，请主人私聊机器人发送 #锅巴解冻 后再试'
    const body = new Result(Constant.FROZEN_CODE, {
      frozen: true,
      reason: info.reason || '',
      at: info.at || 0,
    }, message, 423)
    res.status(body.httpStatus).json(body.toJSON())
  }

  #relativePath(req) {
    const { realMountPrefix } = _paths.server
    let path = req.path || ''
    if (realMountPrefix && path.startsWith(realMountPrefix)) {
      path = path.substring(realMountPrefix.length)
    }
    return path
  }

  static priority = 50
}
