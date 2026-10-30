const IBotService = await Guoba.GID('#/service/interface/IBotService.js')

/**
 * 本部署不接 genshin 的「用户 cookie」概念：米游数据全在 Mys-plugin 自己手里，
 * 首页也不再显示公共 Cookie 数量，这里只保留接口骨架。
 */
export class BotService extends IBotService {
  constructor(app) {
    super(app)
  }

  /** 接口要求实现；当前没有消费方，返回空表 */
  async getUserCookies() {
    return {}
  }
}
