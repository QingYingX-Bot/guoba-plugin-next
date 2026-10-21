import { autowired, Result } from '#guoba.framework'
import { ApiController } from '#guoba.platform'

/**
 * 插件前端页面。
 *
 * 与 custom-page（iframe / 片段）不同，这里的页面是**真正的 Vue 页面**：
 * 由前端路由 `/plugin/@/:name/page/:pageId` 加载，运行在锅巴自己的 Vue 实例里。
 *
 * 接口：
 *   GET /api/plugin-pages/list                      页面清单（按插件分组）
 *   GET /api/plugin-pages/asset/:plugin/:file(*)    页面静态资源（白名单）
 */
export class PluginPagesController extends ApiController {

  pluginWebService = autowired('pluginWebService')

  constructor (guobaApp) {
    super('/plugin-pages', guobaApp)
  }

  registerRouters () {
    this.get('/list', this.getList)
    this.get('/asset/:plugin/*file', this.getAsset)
  }

  /** 页面清单 */
  async getList () {
    await this.pluginWebService.loading
    const out = []
    for (const [plugin, { dirName, pages }] of this.pluginWebService.pages) {
      out.push({
        plugin,
        dirName,
        pages: pages.map(({ entry, ...rest }) => ({ ...rest, component: entry })),
      })
    }
    return Result.ok(out)
  }

  /** 页面静态资源 */
  async getAsset (req, res) {
    await this.pluginWebService.loading
    // Express 5 / path-to-regexp v8：*file 是数组
    const raw = req.params.file
    const file = Array.isArray(raw) ? raw.join('/') : String(raw || '')
    const ret = this.pluginWebService.resolveAsset(req.params.plugin, file)
    if (ret.error) return Result.error(ret.error, ret.status || 404)
    res.sendFile(ret.path)
    return Result.VOID
  }
}
