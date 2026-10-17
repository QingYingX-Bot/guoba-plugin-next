import { autowired, Interceptor, Result } from '#guoba.framework'
import { _paths, Constant } from '#guoba.platform'

/**
 * 二级密码拦截器。
 *
 * 排在 TokenInterceptor（priority 100）之后，此时登录态已经校验过：
 * - 文件管理 / 数据浏览 / 终端 / 消息记录：必须拿着有效的解锁凭证
 * - 运行日志 / 沙盒：平时放行，但二级密码被输错锁定时一起拒绝
 */

/** 需要二级密码的功能 */
const PROTECTED = [
  /^\/api\/file(\/|$)/,
  /^\/api\/data(\/|$)/,
  /^\/api\/term(\/|$)/,
  /^\/api\/chat(\/|$)/,
]

/** 锁定期间一并锁住的功能 */
const LOCKDOWN = [
  /^\/api\/log(\/|$)/,
  /^\/api\/sandbox(\/|$)/,
]

export default class AccessGateInterceptor extends Interceptor {

  accessGateService = autowired('accessGateService')

  async handler(req, res, next) {
    const path = this.#relativePath(req)
    const isProtected = PROTECTED.some(reg => reg.test(path))
    const isLockdown = LOCKDOWN.some(reg => reg.test(path))
    if (!isProtected && !isLockdown) {
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

    if (isProtected && status.needPassword) {
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
