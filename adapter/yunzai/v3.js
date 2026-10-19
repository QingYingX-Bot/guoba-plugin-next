import { hasGenshin, hasPlugin } from "./version.js"

let Restart
try {
  Restart = (await import("../../../other/restart.js")).Restart
} catch {
  Restart = (await import("./mock/system/apps.js")).Restart
}

let MysInfo, MysUser

const importMys = async () => {
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
