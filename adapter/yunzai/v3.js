import { hasGenshin } from "./version.js"

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

if (hasGenshin) {
  try {
    await importMys()
  } catch (e) {
    logger.warn("[Guoba] genshin 插件加载失败，已禁用相关功能")
    logger.error(e)
    await importMockMys()
  }
} else {
  await importMockMys()
}

export {
  Restart,
  MysInfo,
  MysUser
}
