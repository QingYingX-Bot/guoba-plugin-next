import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {pluginName} from './package.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// utils/paths.js -> 插件根目录
const pluginRootFromSelf = path.join(__dirname, '..')

/**
 * 检测并计算真正的 Bot 根目录。
 * 某些宿主（如 JiuLi、al铭文 等）启动时会把 CWD 切到插件目录，
 * 此时 process.cwd() 直接拼 plugins/xxx 会得到嵌套错误路径。
 * 解决方式：如果当前目录的 package.json name 与 pluginName 一致，
 * 说明我们在插件目录里，向上退两级才是 Bot 根目录。
 */
function detectBotRoot() {
  const cwd = process.cwd()

  // 情况1：CWD 是插件目录（比如 JiuLi 启动时 cd 到了插件里）
  try {
    const pkgPath = path.join(cwd, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (pkg.name === 'guoba-plugin' || pkg.name === pluginName) {
        // 向上退两级：plugins/Guoba-Plugin -> plugins -> Bot根目录
        return path.dirname(path.dirname(cwd))
      }
    }
  } catch {}

  // 情况2：CWD 是 plugins 目录
  if (path.basename(cwd) === 'plugins') {
    return path.dirname(cwd)
  }

  // 情况3：默认认为 CWD 就是 Bot 根目录
  return cwd
}

const _path = detectBotRoot()
export const _paths = initPaths()

function initPaths() {
  // BotData目录
  const data = path.join(_path, 'data')
  // Bot资源目录
  const resources = path.join(_path, 'resources')
  // Guoba插件根目录：优先用自身路径推导，避免依赖 CWD
  const pluginRoot = pluginRootFromSelf
  // Guoba静态资源路径
  const staticPath = resolveStaticPath(pluginRoot)
  // 插件资源目录
  const pluginResources = path.join(pluginRoot, 'resources')

  return {
    // Bot根目录
    root: _path,
    data,
    resources,
    pluginRoot,
    staticPath,
    pluginResources,

    server: {
      // 真实挂载路径前缀
      realMountPrefix: "/guoba-plugin-mock-root"
    },
  }
}

/**
 * 选择前端静态目录。
 * 只有当 static-next 里确实有 index.html 时才启用，避免半成品目录导致白屏。
 */
function resolveStaticPath(pluginRoot) {
  const next = path.join(pluginRoot, 'server/static-next')
  if (fs.existsSync(path.join(next, 'index.html'))) {
    return next
  }
  return path.join(pluginRoot, 'server/static')
}

/**
 * 供 version.js 等调用，判断插件目录是否存在。
 * 基于 Bot 根目录而非 CWD。
 */
export function hasPlugin(name) {
  return fs.existsSync(path.join(_path, 'plugins', name))
}
