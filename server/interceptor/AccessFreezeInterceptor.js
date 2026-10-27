import { autowired, Interceptor, Result } from '#guoba.framework'
import { Constant } from '#guoba.platform'
import { normalizeAuthPath } from '../utils/authPath.js'
import { setPortFrozen } from '../utils/freezePortGuard.js'

/**
 * 冻结拦截器。
 *
 * 优先级高于 TokenInterceptor：面板被冻结后，连登录接口也一并拒绝，
 * 只有公开的冻结状态查询（给冻结页轮询用）和静态资源放行。
 * 外网触发的冻结（scope=wan）只拦外网来源，局域网一切照常。
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
    // 进程内状态可能因热重载等原因落后于 redis，这里顺手对齐（只置冻结，解除由 unfreeze 负责）
    setPortFrozen(info.scope === 'wan' ? 'wan' : 'all')
    // 只关外网时局域网照常用；外网请求一般已被端口闸门断掉，走到这里的（如未配可信反代）也拦下
    if (!this.accessFreezeService.isBlocked(info, req)) {
      next()
      return
    }
    const message = '锅巴已冻结，请主人私聊机器人发送 #锅巴解冻 后再试'
    const body = new Result(Constant.FROZEN_CODE, {
      frozen: true,
      reason: info.reason || '',
      at: info.at || 0,
    }, message, 423)
    res.status(body.httpStatus).json(body.toJSON())
  }

  #relativePath(req) {
    // 与路由保持一致地不区分大小写，避免 /API/... 绕过冻结
    return normalizeAuthPath(req)
  }

  static priority = 50
}
