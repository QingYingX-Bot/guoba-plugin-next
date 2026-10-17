import { autowired, Result } from '#guoba.framework'
import { ApiController, Constant } from '#guoba.platform'

/**
 * 二级密码。
 *
 * /api/gate 本身不在受保护前缀里，否则被拦下后连解锁接口都进不去。
 * 登录态仍由 TokenInterceptor 统一校验。
 */
export class AccessGateController extends ApiController {

  accessGateService = autowired('accessGateService')

  constructor(guobaApp) {
    super('/gate', guobaApp)
  }

  registerRouters() {
    this.get('/status', this.status)
    this.post('/unlock', this.unlock)
    this.post('/reset', this.resetPassword)
    this.put('/password', this.setPassword)
    this.delete('/password', this.clearPassword)
  }

  /** 是否已设置、当前会话是否已解锁、是否被锁 */
  async status(req) {
    return Result.ok(await this.accessGateService.getStatus(req))
  }

  async unlock(req) {
    try {
      return Result.ok(await this.accessGateService.unlock(req, req.body), '已解锁')
    } catch (error) {
      // 登录密码输错到阈值：登录凭证已被重置，前端切回登录页走验证码
      if (error?.credentialsReset) {
        return new Result(Constant.CREDENTIALS_RESET_CODE, { credentialsReset: true }, error.message)
      }
      // 连续输错触发冻结：回 423，前端直接切到冻结页
      if (error?.frozen) {
        return new Result(Constant.FROZEN_CODE, { frozen: true }, error.message, 423)
      }
      // 二级密码输错：登录会话已经被服务层作废，回 401 让前端直接回登录页
      if (error?.gateKicked) {
        return new Result(Constant.GATE_FAILED_CODE, {}, error.message, 401)
      }
      throw error
    }
  }

  async setPassword(req) {
    const { currentPassword, password } = req.body ?? {}
    return Result.ok(
      await this.accessGateService.setPassword(currentPassword, password),
      '二级密码已保存',
    )
  }

  /** 忘记二级密码：用登录密码直接重置 */
  async resetPassword(req) {
    const { loginPassword, password } = req.body ?? {}
    try {
      return Result.ok(
        await this.accessGateService.resetPassword(req, loginPassword, password),
        '二级密码已重置',
      )
    } catch (error) {
      if (error?.frozen) {
        return new Result(Constant.FROZEN_CODE, { frozen: true }, error.message, 423)
      }
      throw error
    }
  }

  async clearPassword(req) {
    return Result.ok(
      await this.accessGateService.clearPassword(req.body?.currentPassword),
      '二级密码已关闭',
    )
  }
}
