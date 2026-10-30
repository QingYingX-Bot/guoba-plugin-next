export * from './yunzai/version.js'

/**
 * 重启能力：优先用宿主自带的 `plugins/other/restart.js`（JiuLi / TRSS 布局），
 * 没有就退化成一个明确报错的实现，不再按宿主版本分支。
 */
let Restart
try {
  Restart = (await import('../../other/restart.js')).Restart
} catch {
  Restart = class {
    constructor(e) {
      this.e = e
    }

    restart() {
      logger.error('[Guoba] 缺少 plugins/other/restart.js，无法重启 Bot')
      return false
    }
  }
}

export { Restart }
