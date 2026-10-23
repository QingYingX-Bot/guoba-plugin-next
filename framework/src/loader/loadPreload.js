import fs from "fs";
import path from 'path'
import chalk from 'chalk'
import {Preload} from "../../index.js";
import {loadClass} from "../utils/common.js";

/**
 * 依次创建页面预加载
 * @param {GuobaApplication} guobaApp
 */
export async function usePreload(guobaApp) {
  const {_args: {preloads}} = guobaApp
  for (const item of preloads) {
    await hookAppPreloads(guobaApp, item)
  }
}

/**
 * @param {GuobaApplication} guobaApp
 * @param {PreloadType} preload
 */
async function hookAppPreloads(guobaApp, preload) {
  const importItem = await loadClass(preload.path, Preload, true);
  if (importItem == null) {
    return
  }
  let instance = null
  try {
    // noinspection JSValidateTypes
    instance = new importItem(guobaApp)
  } catch (e) {
    logger.error(`[Guoba] load preload error: ${chalk.red(path.basename(preload.path))}`, e)
    return
  }
  const reg = new RegExp('<!--#GUO\\{' + preload.code + '}BA#-->');
  guobaApp.app.use(async (req, res, next) => {
    const flag = await preload.hook(req)
    if (flag) {
      // WebUI 构建产物（server/static/）不入库，全新部署常常没有 index.html。
      // 这里放行而不是抛异常：否则每个首页请求都会 ENOENT，把日志刷成 ERROR。
      if (!fs.existsSync(preload.staticPath)) {
        logger.debug("[Guoba] WebUI 未构建，跳过 preload 注入：" + preload.staticPath)
        return next()
      }
      // 替换tag：直接内联 preload 内容，避免子应用模式下 /preload/*.js 的路径匹配问题
      const inline = await instance.getPreloadContent()
      const tag = `<script>${inline}</script>`
      const content = fs.readFileSync(preload.staticPath, 'utf8').replace(reg, tag)
      res.send(content)
    } else if (req.path === instance.scriptSrc || req.path.endsWith(path.basename(instance.scriptSrc))) {
      const content = await instance.getPreloadContent()
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      res.send(content)
    } else {
      next();
    }
  })
}
