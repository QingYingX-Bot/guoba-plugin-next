import express from 'express'
import multer from 'multer'
import {cfg, Constant} from '#guoba.platform'

/**
 * 一些辅助工具
 * @param {GuobaApplication} guobaApp
 */
export function useHelper(guobaApp) {
  const {app, _args} = guobaApp
  if (_args.staticPath) {
    // 静态资源
    app.set('views', _args.staticPath)
    app.use(_args.prefix, express.static(_args.staticPath))
    app.get('/robots.txt', (req, res) => {
      res.type('text/plain').send('User-agent: *\nDisallow: /\n')
    })
  }
  // parse application/json
  app.use(express.json({limit: '50mb'}))
  app.use(express.urlencoded({limit: '50mb', extended: true}))

  // 上传文件。
  //
  // 这里有两个必须同时成立的限制，缺一个就是洞：
  // 1) 只处理锅巴自己 API 路径下的 multipart。这个中间件跑在路由之前，如果对所有 POST
  //    生效，未登录往 /guoba/任意路径 传文件也会先落到磁盘上（实测过：回 404，但文件已写出）。
  // 2) 必须带着有效的面板令牌。鉴权在路由层才做，中间件不等鉴权就落盘的话，
  //    没有令牌的人也能反复上传把磁盘灌满。
  // 另外 limits 一定要给：单文件 500MB，最多 20 个文件。
  const upload = multer({
    dest: 'data/upload_tmp/',
    limits: {
      fileSize: 500 * 1024 * 1024,
      files: 20,
      fields: 100,
      parts: 140,
    },
  })
  const mountRoot = cfg.serverMountPath.mountRoot
  const prefixes = [_args.prefix, mountRoot].filter(Boolean)

  /** 去掉挂载前缀后的路径，用 originalUrl 避免受重写中间件影响 */
  const stripMount = (url) => {
    let p = String(url || '').split('?')[0]
    for (const prefix of prefixes) {
      if (p.length >= prefix.length && p.toLowerCase().startsWith(prefix.toLowerCase())) {
        const rest = p.slice(prefix.length)
        if (rest === '' || rest.startsWith('/')) {
          p = rest || '/'
          break
        }
      }
    }
    return p
  }

  const isGuobaApi = (req) => /^\/api(\/|$)/i.test(stripMount(req.originalUrl || req.url))

  const hasAccessToken = async (req) => {
    const token = req.headers?.[Constant.TOKEN_KEY]
    if (!token || typeof token !== 'string') return false
    if (typeof redis === 'undefined' || !redis?.get) return true
    try {
      return !!(await redis.get(Constant.REDIS_PREFIX + 'access-token:' + token))
    } catch {
      // redis 挂了就别落盘，宁可让请求在鉴权层被拒
      return false
    }
  }

  // 用正则而不是字符串通配符：'*' 在 express 5（path-to-regexp v8）注册时就抛 Missing parameter
  // name，服务直接起不来；'*splat' 反过来在 express 4 匹配不上，multipart 请求会一路裸奔到业务
  // 路由，body 解析不了（表现为发消息报「消息内容不能为空」）。
  // /.*/ 在两个版本里都能匹配所有 POST；multer 对非 multipart 请求直接 next，不影响 JSON 接口。
  app.post(/.*/, async (req, res, next) => {
    if (!isGuobaApi(req) || !(await hasAccessToken(req))) {
      next()
      return
    }
    upload.any()(req, res, next)
  }, function (req, res, next) {
    next()
  })
}
