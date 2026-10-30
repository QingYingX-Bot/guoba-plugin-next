import path from "path";
import fs from "fs";
import {spawn} from "node:child_process";
import {GuobaApplication} from "#guoba.framework";
import {_paths, cfg, GuobaSupportMap, PluginsMap} from '#guoba.platform';
import {hostName, isTRSS} from '#guoba.adapter'
import {getWebAddress} from '#guoba.utils'
import {listen} from './helper/listen.js'
import chalk from 'chalk'
import {installLanGuard} from './utils/lanGuard.js'

const {mountRoot, mountRootWithSlash} = cfg.serverMountPath
const realRoot = _paths.server.realMountPrefix + '/'

// 自动构建只触发一次：createServer 可能因重载被多次调用
let autoBuildStarted = false

export async function createServer({isInit}) {
  const begin = Date.now()
  // 初始化
  PluginsMap.clear()
  GuobaSupportMap.clear()

  const serverPort = cfg.serverPort

  const args = {
    app: null,
    server: null,
    port: serverPort,
  }

  if (isTRSS && cfg.get('server.helloTRSS') && Bot.express) {
    args.app = Bot.express
    args.server = Bot.server
    // 宿主可能是 TRSS-Yunzai 本身，也可能是它的 fork（Orangezai 等），名字照实说
    logger.mark(`[Guoba] 当前运行在 ${hostName || 'TRSS'} 环境，已共享端口号`)
    const urls = []
    urls.push(_paths.server.realMountPrefix)
    if (mountRoot !== '/') {
      urls.push(mountRoot)
    }
    if (Array.isArray(Bot.express.quiet)) {
      Bot.express.quiet.push(...urls)
    }
    if (Array.isArray(Bot.express.skip_auth)) {
      Bot.express.skip_auth.push(...urls)
    }
  }

  // 子应用模式：宿主（JiuLi 等）已经提供了 express 实例，直接挂上去，不自己监听端口。
  // 这样重载不会关掉宿主的 server，也不会出现端口抢占和空窗期。
  const hostExpress = globalThis.Bot?.express
  const hostServer = globalThis.Bot?.server
  if (hostExpress && typeof hostExpress.use === 'function') {
    logger.mark('[Guoba] 检测到宿主 express，以子应用方式挂载（不占用端口）')
    Guoba.parentApp = hostExpress
    args.parentApp = hostExpress
    args.mount = _paths.server.realMountPrefix
    args.mountAliases = ["/guoba"]
    // 关键：清掉 isTRSS 分支可能设置的 args.app，否则会变成"宿主 app 挂到自己身上"
    args.app = null
    args.server = hostServer || null
    try {
      if (Array.isArray(hostExpress.skip_auth)) {
        hostExpress.skip_auth.push(args.mount, ...args.mountAliases)
      }
    } catch { /* ignore */ }
  } else {
    delete Guoba.parentApp
  }

  // WebUI 构建产物（server/static/）已入库，正常 clone 下来就有 index.html。
  // 兜底：万一缺失（从旧版本升级、手工删过、或同步上游时被覆盖），后台自动补构建一次。
  const webIndex = path.join(_paths.staticPath, "index.html")
  if (!fs.existsSync(webIndex) && !autoBuildStarted) {
    autoBuildStarted = true
    const builder = path.join(_paths.pluginRoot, "scripts/build-web.mjs")
    if (!fs.existsSync(builder)) {
      logger.warn("[Guoba] WebUI 未构建，且找不到构建脚本：" + builder)
      logger.warn('[Guoba] 请手动执行：cd "' + _paths.pluginRoot + '" && npm run build')
    } else {
      logger.warn("[Guoba] WebUI 未构建，正在后台自动构建（首次需装依赖，约 1-2 分钟）")
      logger.warn("[Guoba] 构建期间面板会 404，完成后刷新即可，无需重启")
      const child = spawn(process.execPath, [builder], {
        cwd: _paths.pluginRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, GUOBA_AUTO_BUILD: "1"}
      })
      const tail = []
      const consume = (stream) => {
        let buf = ""
        stream.on("data", chunk => {
          buf += String(chunk)
          const lines = buf.split("\n")
          buf = lines.pop()
          for (const raw of lines) {
            const line = raw.trimEnd()
            if (!line.trim()) continue
            tail.push(line)
            if (tail.length > 40) tail.shift()
            // 只把构建脚本自己的进度打到日志，npm 的噪声留在 tail 里等失败时再吐
            if (line.indexOf("[Guoba]") >= 0) logger.info("[Guoba][build] " + line.trim())
          }
        })
      }
      consume(child.stdout)
      consume(child.stderr)
      child.on("error", err => logger.error("[Guoba] 自动构建启动失败：" + err.message))
      child.on("exit", code => {
        if (code === 0) {
          logger.mark("[Guoba] WebUI 构建完成，刷新面板即可")
        } else {
          logger.error("[Guoba] WebUI 自动构建失败（exit " + code + "），最近输出：")
          for (const line of tail.slice(-15)) logger.error("[Guoba][build] " + line)
          logger.error('[Guoba] 请手动执行：cd "' + _paths.pluginRoot + '" && npm run build')
        }
      })
    }
  }

  // 启动服务
  const application = await GuobaApplication.run({
    ...args,
    // 子应用模式下父层已经切掉了挂载前缀，锅巴内部应按根路径处理
    prefix: args.parentApp ? "/" : _paths.server.realMountPrefix,
    staticPath: _paths.staticPath,
    created: appCreated,
    componentPaths: [
      path.join(_paths.pluginRoot, 'server/interceptor'),
      path.join(_paths.pluginRoot, 'server/service', 'both'),
      path.join(_paths.pluginRoot, 'server/service', 'v3'),
      path.join(_paths.pluginRoot, 'server/controller'),
    ],
    preloads: [
      {
        code: `PRELOAD_JS`,
        hook: (req) => {
          // 子应用模式下父层已切掉挂载前缀，req.path 是 / 或 /index.html；
          // 独立端口模式下是 realRoot 或 realRoot + 'index.html'，两种都放行
          const path = req.path || req.originalUrl
          return path === realRoot || path === realRoot + 'index.html' ||
                 path === '/' || path === '/index.html'
        },
        path: path.join(_paths.pluginRoot, 'server/preload/ConfigPreload.js'),
        staticPath: path.join(_paths.staticPath, 'index.html'),
      }
    ],
    decorators: [
      {
        path: path.join(_paths.pluginRoot, 'server/decorator/ReqDecorator.js'),
        args: [],
      }
    ],
    overrides: {
      listen: listen,
    }
  })
  const app = application.app
  const server = application.server
  // 首次启动输出提示信息
  if (isInit) {
    const tipText = `[Guoba] 启动成功 >_< 耗时: ${Date.now() - begin}ms`
    const hosts = getWebAddress(true)
    const maxLength = Math.max(30, ...hosts.map(host => host.length), tipText.length + 6) + 4;
    logger.mark('#'.repeat(maxLength))
    logger.mark(`# ${chalk.green(tipText)} #`)
    logger.info('# ' + chalk.green('登录地址：') + ' '.repeat(maxLength - 14) + ' #')
    for (let host of hosts) {
      logger.info('# ' + chalk.cyan(host) + ' '.repeat(maxLength - host.length - 4) + ' #')
    }
    logger.info('# ' + chalk.magenta('请妥善保管登陆地址，避免泄露！') + ' '.repeat(maxLength - 34) + ' #')
    logger.mark('#'.repeat(maxLength))
    // 面板默认只开给局域网，第一次装的人不提示就会以为地址坏了
    logger.info(chalk.yellow('[Guoba] 面板默认只允许局域网访问'))
    logger.info(chalk.yellow('[Guoba] 需要从外网访问：聊天里发「#开启锅巴外网」，用完发「#关闭锅巴外网」'))
  }
  return {app, server}
}

function appCreated(guobaApp) {
  const {app} = guobaApp
  // 外网闸门：默认只让局域网打开面板，必须排在所有锅巴路由之前
  installLanGuard(app, [mountRootWithSlash, realRoot, mountRoot])
  // 重定向根路径，用于自定义挂载路径路径
  app.use((req, res, next) => {

    if (req.originalUrl.startsWith(realRoot)) {
      next()
      return
    }

    // 1. 请求的是挂载根路径
    if (req.path === mountRoot) {
      if (req.path !== '/') {
        // 替换保留参数并重定向
        const url = req.originalUrl.replace(mountRoot, mountRootWithSlash)
        res.redirect(url)
        return
      }
    }
    // 2. 请求的是以挂载根路径开头的
    if (req.originalUrl.startsWith(mountRootWithSlash)) {
      // 替换为真实根路径，并继续
      req.url = req.originalUrl.replace(mountRootWithSlash, realRoot)
    }
    next()
  })
}
