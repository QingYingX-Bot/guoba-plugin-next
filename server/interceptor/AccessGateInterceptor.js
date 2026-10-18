import { autowired, Interceptor, Result } from '#guoba.framework'
import { _paths, Constant } from '#guoba.platform'

/**
 * 二级密码拦截器。
 *
 * 排在 TokenInterceptor（priority 100）之后，此时登录态已经校验过：
 * 只有下面这些功能需要额外的解锁凭证；运行日志 / 沙盒在冻结时由
 * AccessFreezeInterceptor 统一拒绝，这里不用重复处理。
 */

/** 需要二级密码的功能 */
const PROTECTED = [
  /^\/api\/file(\/|$)/,
  /^\/api\/data(\/|$)/,
  /^\/api\/term(\/|$)/,
  /^\/api\/chat(\/|$)/,
  // 账号管理：Bot 账号 / 好友群列表 / 广播
  /^\/api\/oicq(\/|$)/,
  // 登录安全：改登录密码、可信 IP / 设备都在这里
  /^\/api\/login\/security(\/|$)/,
]

export default class AccessGateInterceptor extends Interceptor {

  accessGateService = autowired('accessGateService')

  async handler(req, res, next) {
    const path = this.#relativePath(req)
    if (!PROTECTED.some(reg => reg.test(path))) {
      next()
      return
    }

    let status
    try {
      status = await this.accessGateService.checkAccess(req)
    } catch (err) {
      // 校验本身出错时绝不放行，宁可让人刷新重试
      logger.error('[Guoba] 二级密码校验失败')
      logger.error(err)
      return this.#reject(res, Constant.GATE_REQUIRED_CODE, '无法校验二级密码，请刷新重试')
    }

    if (status.needPassword) {
      return this.#reject(res, Constant.GATE_REQUIRED_CODE, '此功能需要二级密码')
    }
    next()
  }

  #reject(res, code, message, result = {}) {
    // 直接 new Result：Result.error 的参数顺序在框架里有点绕，这里要的是
    // {ok:false, code, result, message} 这个固定结构
    const body = new Result(code, result, message, 403)
    res.status(body.httpStatus).json(body.toJSON())
  }

  /** 去掉自定义挂载前缀，得到 /api/... 开头的路径 */
  #relativePath(req) {
    const { realMountPrefix } = _paths.server
    let path = req.path || ''
    if (realMountPrefix && path.startsWith(realMountPrefix)) {
      path = path.substring(realMountPrefix.length)
    }
    return path
  }

  static priority = 200
}
