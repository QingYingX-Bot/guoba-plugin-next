import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Mys-plugin 数据适配（替代 genshin 的 MysInfo / MysUser）。
 *
 * 注意：这里**不能** import `#guoba.platform`（`models/platform.js`）。
 * adapter 在锅巴启动早期被加载，此时 platform 还没初始化，会导致顶层 await 永久挂起。
 * 所以所有路径都从 `import.meta.url` 往上推。
 *
 * 目录关系：
 *   <JiuLi>/plugins/Guoba-Plugin/adapter/yunzai/mock/mys/index.js   ← 本文件
 *   <JiuLi>/data/Mys-plugin/db/data.db                              ← 目标数据库
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const guobaRoot = path.resolve(here, '../../../../')        // plugins/Guoba-Plugin
const pluginsDir = path.dirname(guobaRoot)                  // plugins/
const hostRoot = path.dirname(pluginsDir)                   // JiuLi 根
const botRoot = path.resolve(hostRoot, '../../..')           // Bot 根

/** 按常见部署位置找 Mys-plugin 的 sqlite 数据库 */
function findDb () {
  const candidates = [
    path.join(hostRoot, 'data/Mys-plugin/db/data.db'),
    path.join(botRoot, 'data/Mys-plugin/db/data.db'),
    path.join(pluginsDir, 'Mys-plugin/data/db/data.db'),
    path.join(pluginsDir, 'Mys-plugin/db/data.db'),
  ]
  for (const file of candidates) {
    try { if (fs.existsSync(file)) return path.resolve(file) } catch { /* ignore */ }
  }
  return ''
}

/** sqlite3 在宿主的 node_modules 里（Mys-plugin 的依赖） */
function loadSqlite3 () {
  // 优先走 Node 的模块解析（会从本文件往上找到 JiuLi/node_modules/sqlite3）
  try {
    const mod = require('sqlite3')
    if (mod && typeof mod.Database === 'function') return mod
  } catch { /* ignore */ }
  // 兜底：显式按路径加载，兼容 exports 只导出默认的情况
  const candidates = [
    path.join(hostRoot, 'node_modules/sqlite3'),
    path.join(botRoot, 'node_modules/sqlite3'),
  ]
  for (const dir of candidates) {
    try {
      const mod = require(dir)
      if (mod && typeof mod.Database === 'function') return mod
      if (mod?.default && typeof mod.default.Database === 'function') return mod.default
    } catch { /* ignore */ }
  }
  return null
}

function query (dbPath, sql, params = []) {
  const sqlite3 = loadSqlite3()
  if (!sqlite3) return Promise.reject(new Error('sqlite3 不可用'))
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err)
      // 宿主在写库（自动签到等任务）时让读等待而不是立即报 SQLITE_BUSY
      db.configure("busyTimeout", 2000)
      db.all(sql, params, (e, rows) => {
        db.close(() => {})
        if (e) return reject(e)
        resolve(rows || [])
      })
    })
  })
}

/** 统计 MysUsers 表：总凭据数、有 CK 的数、有 SK 的数 */
async function readCounts () {
  const dbPath = findDb()
  if (!dbPath) throw new Error('未找到 Mys-plugin 数据库')
  const rows = await query(dbPath, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ck IS NOT NULL AND ck <> '' THEN 1 ELSE 0 END) AS ckCount,
      SUM(CASE WHEN stoken IS NOT NULL AND stoken <> '' THEN 1 ELSE 0 END) AS skCount
    FROM MysUsers
  `)
  const row = rows[0] || {}
  return {
    total: Number(row.total) || 0,
    ck: Number(row.ckCount) || 0,
    sk: Number(row.skCount) || 0,
  }
}

export class MysUser {
  /**
   * 与 genshin 的 MysUser.getStatData() 对齐：
   * 锅巴首页只取 count.total（展示为「公共 Cookie」）。
   */
  static async getStatData () {
    try {
      const counts = await readCounts()
      return {
        count: {
          total: counts.ck,     // 有 CK 的账号数 = 锅巴首页「公共 Cookie」
          ck: counts.ck,
          sk: counts.sk,
          all: counts.total,
        },
      }
    } catch (e) {
      logger.warn('[Guoba] Mys-plugin 数据适配读取失败：', e.message || e)
      return { count: { total: -1 } }
    }
  }
}

export class MysInfo {
  /** 兼容 genshin 同名接口；Mys 没有「绑定 CK 映射」的概念，返回空表 */
  static async getBingCkUid () {
    return {}
  }

  /** 兼容 genshin 同名接口；Mys 直接读库，无需预热缓存 */
  static async initCache () {
    return {}
  }
}
