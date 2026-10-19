import fs from 'node:fs'
import path from 'node:path'
import { hasGenshin, hasPlugin } from "./version.js"

let Restart
try {
  Restart = (await import("../../../other/restart.js")).Restart
} catch {
  Restart = (await import("./mock/system/apps.js")).Restart
}

let MysInfo, MysUser

const importMys = async () => {
  // genshin 残缺（目录在但关键文件缺失）时直接走 mock：动态 import 抛
  // ERR_MODULE_NOT_FOUND 会经 JiuLi 的解析 hook + HTTP 错误兜底打出一大条
  // ERROR 堆栈，这里提前探测把噪音消在源头
  const target = path.resolve(import.meta.dirname, '../../../genshin/model/mys/mysInfo.js')
  if (!fs.existsSync(target)) {
    logger.mark('[Guoba] genshin 残缺（缺少 model/mys/mysInfo.js），建议清理该目录，锅巴正常启动不受影响')
    await importMockMys()
    return
  }
  MysInfo = (await import("../../../genshin/model/mys/mysInfo.js")).default
  MysUser = (await import("../../../genshin/model/mys/MysUser.js")).default
}

const importMockMys = async () => {
  const mys = await import("./mock/genshin/mys.js")
  MysInfo = mys.MysInfo
  MysUser = mys.MysUser
}

// 没有 genshin 但有 Mys-plugin 时，用 Mys 的数据库提供统计（替代写死 -1 的 mock）
const importMysPluginMys = async () => {
  const mys = await import("./mock/mys/index.js")
  MysInfo = mys.MysInfo
  MysUser = mys.MysUser
}

if (hasGenshin) {
  try {
    await importMys()
  } catch (e) {
    logger.warn("[Guoba] genshin 插件加载失败，已禁用相关功能")
    logger.error(e)
    await importMockMys()
  }
} else if (hasPlugin("Mys-plugin")) {
  await importMysPluginMys()
  logger.mark("[Guoba] 未安装 genshin，统计已切换为 Mys-plugin 数据适配")
} else {
  await importMockMys()
}

export {
  Restart,
  MysInfo,
  MysUser
}
