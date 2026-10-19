import express from 'express'
import {useHelper} from './loader/loadHelper.js'
import {usePreload} from './loader/loadPreload.js'
import {useDecorator} from "./loader/loadDecorator.js";
import {useComponents} from './loader/loadComponents.js'

/**
 * @typedef PreloadType
 * @property {Function} hook 预加载html钩子
 * @property {String} path 预加载文件路径
 * @property {String} code 预加载代码
 * @property {String} staticPath 静态资源路径
 */

/**
 * @typedef DecoratorType
 * @property {String} path 装饰器路径
 * @property {*[]} args 参数
 */

/**
 * @typedef GuobaAppArgs
 * @property {Express} app
 * @property {http.Server} server
 * @property {string} prefix 路由前缀
 * @property {Boolean} hotReload TODO 是否热加载
 * @property {Number} port 服务端口
 *
 * @property {Function} created 生命周期函数：应用创建完成回调
 * @property {Function} mounted 生命周期函数：应用挂载完成回调
 *
 * @property {String} basePath 项目根路径
 * @property {String} staticPath 静态资源路径
 * @property {String[]} componentPaths 组件路径 - 包括 controller、service等
 * @property {PreloadType[]} preloads 预加载配置
 * @property {DecoratorType[]} decorators 全局预设装饰器
 * @property {Object<String, Function>} overrides 重新默认逻辑
 *
 */

/**
 * Guoba Application
 * @class GuobaApplication
 */
export default class GuobaApplication {

  /** @type GuobaAppArgs */
  _args
  /** @type Express */
  app
  /** @type http.Server */
  server

  globalDecorators = []

  /**
   * 启动应用
   * @param {GuobaAppArgs} args 应用配置
   * @returns {GuobaApplication}
   */
  static async run(args) {
    const app = args?.app ? args.app : express()
    const parentApp = args?.parentApp
    let server
    if (parentApp) {
      // 子应用模式：挂到宿主 express 的指定前缀下，复用宿主的 http server（不占用端口）
      const getStack = () => parentApp._router?.stack || parentApp.router?.stack
      const mountList = [args.mount || '/', ...(args.mountAliases || [])].filter((v, i, arr) => v && arr.indexOf(v) === i)
      for (const prefix of mountList) parentApp.use(prefix, app)
      // 宿主可能在插件初始化之后才注册兜底 302，把刚挂上去的层直接提到栈顶。
      // 锅巴只处理自己前缀，其余请求原样 next() 下去，不影响宿主。
      const stack = getStack()
      const count = mountList.length
      if (Array.isArray(stack) && stack.length >= count) {
        const added = stack.slice(-count)
        stack.length -= count
        stack.unshift(...added)
        const names = stack.slice(0, 6).map((l) => l.name || String(l.regexp || '').slice(0, 30))
        logger.debug(`[Guoba] 挂载层已前置 count=${count} total=${stack.length} 前6层=${JSON.stringify(names)}`)
      } else {
        logger.mark(`[Guoba] 挂载层前置失败 count=${count} total=${Array.isArray(stack) ? stack.length : -1}`)
      }
      server = args?.server || null
    } else {
      server = args?.server ? args.server : await getListenFn(args)(app, args.port)
    }
    const guobaApp = new GuobaApplication(args, app, server);

    if (typeof args.created === 'function') {
      args.created(guobaApp)
    }

    // 预加载
    await usePreload(guobaApp);
    // 辅助工具
    useHelper(guobaApp);
    // 预装饰器配置
    await useDecorator(guobaApp);
    // 加载全部组件
    await useComponents(guobaApp);

    if (typeof args.mounted === 'function') {
      args.mounted(guobaApp)
    }

    return guobaApp
  }

  /**
   * 启动应用
   *
   * @param {GuobaAppArgs} args 应用配置
   * @param app express创建的app
   * @param server app创建监听之后的server
   * @returns {GuobaApplication}
   */
  constructor(args, app, server) {
    this._args = args;
    this.app = app
    this.server = server
    /** 子应用模式下宿主的 express（JiuLi 等），重载时用它替换挂载层 */
    this.parentApp = args?.parentApp
    /** 挂载前缀 */
    this.mount = args?.mount
  }

  /** 从宿主 express 上摘掉自己（重载前调用） */
  unmount() {
    const parent = this.parentApp
    if (!parent) return false
    const stack = parent._router?.stack || parent.router?.stack
    if (!Array.isArray(stack)) return false
    let removed = 0
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].handle === this.app) {
        stack.splice(i, 1)
        removed++
      }
    }
    return removed > 0
  }

}

/**
 * 获取实际的监听函数
 * @param args
 * @return {function(*, *): Promise<http.Server>}
 */
function getListenFn(args) {
  const listen = args?.overrides?.listen;
  if (typeof listen === "function") {
    return listen
  }
  return defaultListen
}

/** 默认的监听函数 */
function defaultListen(app, port) {
  return app.listen(port)
}
