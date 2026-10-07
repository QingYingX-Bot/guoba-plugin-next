import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 三种获取插件名的方式
// console.log('pluginName 1:', path.basename(path.join(import.meta.url, '../../')))
// console.log('pluginName 2:', import.meta.url.match(/[\/\\](GUOBA-PLUGIN)[\/\\]/i)[1])
// console.log('pluginName 3:', path.basename(path.dirname(path.dirname(import.meta.url))))

/** Guoba实际所在的目录名 */
export const pluginName = path.basename(path.join(import.meta.url, '../../'))

/**
 * 基于自身文件路径定位 package.json，而不是依赖进程 CWD。
 * 这样无论宿主是 Yunzai-Bot/V3/V4/TRSS/JiuLi，还是单测、二次封装，
 * 都能稳定找到真正的插件目录。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// utils/package.js -> 插件根目录是上一级
const pluginRoot = path.join(__dirname, '..')
const packagePath = path.join(pluginRoot, 'package.json')

export const pluginPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

/** Guoba当前版本 */
export const _version = pluginPackage.version
