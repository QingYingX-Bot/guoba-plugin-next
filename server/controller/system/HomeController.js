import fs from 'fs'
import path from 'path'
import lodash from 'lodash'
import {_paths, ApiController} from '#guoba.platform'
import {autowired, Result} from '#guoba.framework'

/**
 * 首页相关查询
 */
export class HomeController extends ApiController {

  botService = autowired('botService')
  oicqService = autowired('oicqService')
  statusService = autowired('statusService')

  constructor(guobaApp) {
    super('/home', guobaApp)
  }

  registerRouters() {
    this.get('/data', this.getHomeData)
    this.get('/status', this.getSystemStatus)
    this.get('/msg-stat', this.getMsgStat)
    this.get('/random-image', this.randomImage)
  }

  /** 获取首页数据 */
  async getHomeData() {
    return Result.ok({
      friendCount: await this.oicqService.getFriendCount(),
      groupCount: await this.oicqService.getGroupCount(),
    })
  }

  /** 系统状态：负载、CPU、内存、磁盘、运行时长 */
  async getSystemStatus() {
    return Result.ok(await this.statusService.getSystemStatus())
  }

  /** 消息统计：收发量、近 7 天趋势、各 Bot 账号 */
  async getMsgStat(req) {
    const days = Math.min(30, Math.max(1, Number(req.query?.days) || 7))
    const [stat, bots] = await Promise.all([
      this.statusService.getMsgStat(days),
      this.statusService.getBotStat(),
    ])
    return Result.ok({...stat, bots})
  }

  // 随机背景图：往 resources/images/hero/ 丢图即参与随机，目录为空则回落到 no-miao.png
  async randomImage(req, res) {
    const fallback = this.getRandomHeroImage()
    res.sendFile(fallback ?? path.join(_paths.pluginResources, 'images/no-miao.png'))
    return Result.VOID
  }

  /**
   * 裁掉立绘四周的空白边。
   *
   * 面板图素材约一半是「人物偏一侧、另一侧大片留白」的构图（喵喵渲染面板时
   * 在留白处叠文字），前端直接展示就会出现大块白边。这里用 sharp 的 trim
   * 按边缘颜色去边，得到只含人物的紧凑图。
   *
   * 裁完结果缓存在内存里，避免同一张图反复解码 —— 面板图最大有 5501×2655，
   * 一次 trim 要几百毫秒。
   */

  /**
   * 锅巴自带的兜底立绘。
   *
   * 往 resources/images/hero/ 里丢图就会自动参与随机，不用改代码；
   * 目录被清空则回落到 no-miao.png。
   */
  getRandomHeroImage() {
    const dir = path.join(_paths.pluginResources, 'images/hero')
    let files = []
    try {
      files = fs.readdirSync(dir).filter((p) => /\.(jpg|jpeg|png|webp|gif)$/i.test(p))
    } catch {
      // 目录不存在，当没图处理
    }
    if (files.length === 0) {
      return null
    }
    return path.join(dir, lodash.sample(files))
  }

  // 安装了喵喵插件后，获取随机角色图片

}
