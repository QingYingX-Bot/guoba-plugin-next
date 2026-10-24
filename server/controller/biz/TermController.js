import {autowired, GuobaError, Result} from '#guoba.framework'
import {ApiController, cfg} from '#guoba.platform'

/**
 * 终端。
 *
 * 命令在面板进程所在环境执行，等同服务器 shell —— 只有登录面板的人能碰
 * （TokenInterceptor 全局鉴权）。危险命令的确认由前端弹框。
 */
export class TermController extends ApiController {

  termService = autowired('termService')

  constructor(guobaApp) {
    super('/term', guobaApp)
  }

  /**
   * 网页终端等同服务器 shell（宿主是 root 就是 root shell）。
   * 默认关闭，要在终端页的开关或配置里显式打开才放行。
   */
  #assertEnabled() {
    if (cfg.get('security.enableTerminal') === true) return
    throw new GuobaError('终端已关闭，打开终端页的「终端」开关后才能执行命令')
  }

  registerRouters() {
    this.post('/exec', this.exec)
    this.get('/tail', this.tail)
    this.post('/interrupt', this.interrupt)
    this.post('/restart', this.restart)
    this.get('/status', this.status)
    this.post('/enabled', this.setEnabled)
  }

  /**
   * 开关终端，写回 security.enableTerminal。
   * 这条路由在 /api/term 下，二级密码拦截器会先挡一道，等于开 shell 要解锁。
   */
  async setEnabled(req) {
    const enabled = req.body?.enabled === true
    cfg.set('security.enableTerminal', enabled)
    logger.mark(`[Guoba] 网页终端${enabled ? '已启用' : '已关闭'}`)
    return Result.ok({enabled}, enabled ? '终端已启用' : '终端已关闭')
  }

  /** 执行一条命令，写入 shell 的 stdin */
  async exec(req) {
    this.#assertEnabled()
    const {cmd} = req.body ?? {}
    return Result.ok(this.termService.exec(cmd))
  }

  /** 增量拉取输出，cursor 游标 */
  async tail(req) {
    const {cursor} = req.query ?? {}
    return Result.ok(this.termService.query(cursor))
  }

  /** 中断当前前台进程（键盘 Ctrl+C 的等价） */
  async interrupt() {
    this.#assertEnabled()
    return Result.ok(this.termService.interrupt())
  }

  /** 重启 shell 会话（清空输出） */
  async restart() {
    this.#assertEnabled()
    return Result.ok(this.termService.restart())
  }

  /** 会话信息。enabled 给终端页的开关用（开关本身也走二级密码鉴权） */
  async status() {
    return Result.ok({
      ...this.termService.status(),
      enabled: cfg.get('security.enableTerminal') === true,
    })
  }

}
