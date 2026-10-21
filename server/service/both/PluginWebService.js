import fs from 'node:fs'
import path from 'node:path'
import { Service } from '#guoba.framework'
import { _paths } from '#guoba.platform'

/** 页面 id：只允许字母数字下划线中划线 */
const PAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 静态资源白名单（插件页面自包含，允许少量常见静态类型） */
const ALLOWED_EXT = /\.(js|cjs|mjs|css|json|png|jpe?g|svg|webp|gif|ico|woff2?|ttf)$/i

/**
 * 插件自带的前端页面（`plugins/<插件>/web/pages.json`）。
 *
 * 与 custom-page 的区别：这里注册的是**真正的 Vue 页面**，由前端路由加载，
 * 运行在锅巴自己的 Vue 实例里（同一套 antd、同一套主题），不经过 iframe 或 innerHTML。
 *
 * 目录约定：
 *   plugins/<插件名>/web/pages.json
 *   plugins/<插件名>/web/pages/<页面id>.js   → export function mount(el)
 */
export default class PluginWebService extends Service {

  constructor (app) {
    super(app)
    /** 小写插件名 -> 页面数组 */
    this.pages = new Map()
    this.loading = Promise.resolve().then(() => this.loadAll())
  }

  /** 扫描所有插件的 web/pages.json */
  async loadAll () {
    this.pages.clear()
    const pluginsRoot = path.join(_paths.root, 'plugins')
    let dirs = []
    try {
      dirs = fs.readdirSync(pluginsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch (e) {
      logger.warn('[Guoba] 读取插件目录失败：', e.message || e)
      return
    }
    for (const dirName of dirs) {
      const webDir = path.join(pluginsRoot, dirName, 'web')
      const manifest = path.join(webDir, 'pages.json')
      if (!fs.existsSync(manifest)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        const list = Array.isArray(raw) ? raw : (raw?.pages ?? [])
        const pages = []
        for (const def of list) {
          const id = String(def?.id ?? '').trim()
          const title = String(def?.title ?? '').trim()
          if (!PAGE_ID_RE.test(id) || !title) {
            logger.warn(`[Guoba] 「${dirName}」页面定义非法（id/title）：${JSON.stringify(def)}`)
            continue
          }
          const entry = String(def?.component ?? `pages/${id}.js`).replace(/^\.\//, '')
          if (!ALLOWED_EXT.test(entry) || entry.includes('..') || path.isAbsolute(entry)) {
            logger.warn(`[Guoba] 「${dirName}」页面 ${id} 的入口非法：${entry}`)
            continue
          }
          pages.push({
            id,
            title,
            icon: String(def?.icon ?? 'ant-design:file-outlined'),
            entry,
            priority: Number(def?.priority) || 100,
            group: String(def?.group ?? ''),
          })
        }
        if (pages.length) {
          pages.sort((a, b) => a.priority - b.priority)
          this.pages.set(dirName.toLowerCase(), { dirName, pages })
        }
      } catch (e) {
        logger.warn(`[Guoba] 读取「${dirName}」的 web/pages.json 失败：`, e.message || e)
      }
    }
    if (this.pages.size) {
      const summary = [...this.pages].map(([k, v]) => `${v.dirName}(${v.pages.length})`).join(', ')
      logger.mark(`[Guoba] 插件页面：${summary}`)
    }
  }

  /** 重新扫描（页面清单改动后调用） */
  async reload () {
    await this.loadAll()
    return this.pages.size
  }

  getPages (name) {
    return (this.pages.get(String(name ?? '').toLowerCase()) || {}).pages || []
  }

  /** 插件真实目录名（保留大小写），API owner 拼路径用 */
  getDirName (name) {
    return this.#dirOf(String(name ?? '').toLowerCase())
  }

  hasPages (name) {
    return this.getPages(name).length > 0
  }

  /** 反查插件的真实目录名（保留大小写） */
  #dirOf (lowerName) {
    const pluginsRoot = path.join(_paths.root, 'plugins')
    try {
      return fs.readdirSync(pluginsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.toLowerCase() === lowerName)
        .map((d) => d.name)[0] || ''
    } catch {
      return ''
    }
  }

  /** 解析页面静态资源路径（白名单 + 目录越界校验） */
  resolveAsset (name, file) {
    const lower = String(name ?? '').toLowerCase()
    if (!this.pages.has(lower)) return { error: '插件未注册页面', status: 404 }
    const rel = String(file ?? '').replace(/\\/g, '/')
    if (!ALLOWED_EXT.test(rel) || rel.includes('..') || path.isAbsolute(rel)) {
      return { error: '资源类型不允许', status: 404 }
    }
    const dirName = this.#dirOf(lower)
    if (!dirName) return { error: '插件目录不存在', status: 404 }
    const webDir = path.resolve(_paths.root, 'plugins', dirName, 'web')
    const target = path.resolve(webDir, rel)
    if (!target.startsWith(webDir + path.sep)) return { error: '路径越界', status: 403 }
    if (!fs.existsSync(target)) return { error: '资源不存在', status: 404 }
    return { path: target }
  }
}
