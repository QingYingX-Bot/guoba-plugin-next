import fs from 'fs'
import path from 'path'
import {hasPlugin} from '#guoba.adapter'
import {_paths} from '#guoba.platform'
import {YamlReader} from '#guoba.framework'

/**
 * QQBot 消息存储设置 —— 由 Guoba 顶上的那部分。
 *
 * 背景：「消息记录」的落库代码、SQLite 句柄（`Bot.MessageDB` / `MsgIdxDB` / `ActiveListDB`）、
 * Redis 写入与过期清理**全都是 QQBot-Plugin 自己的**（`plugins/QQBot-Plugin/index.js:40-42`、
 * `lib/message.js`、`lib/media.js`）。QQBot-Web-Adapter 只贡献了这几个 `Bot.*` 配置值，
 * 外加读这些数据给它自己的面板用。
 *
 * 也就是说：只要有人把 `Bot.*` 赋上，不装 Web-Adapter 消息记录照样能跑。
 * 所以没装 Web-Adapter 时，由 Guoba 从 `config/QQBot.yaml` 读这几个值并赋值。
 *
 */
export const QQBOT_CONFIG_FILE = '/config/QQBot.yaml'

/** 消息存储设置的字段与默认值，顺序即面板显示顺序 */
export const QQBOT_STORAGE_DEFAULTS = {
  autoRecordMessage: true,
  storageBackend: 'redis',
  autoDownloadImgorVideo: true,
  maxMediaCacheSize: 10,
  saveTimes: 3,
}

export const QQBOT_STORAGE_FIELDS = Object.keys(QQBOT_STORAGE_DEFAULTS)

/**
 * 这几个值该不该由 Guoba 管。
 *
 * 装了 QQBot-Web-Adapter 就完全交给它 —— 它会在自己的 `loadConfig()` 里写 `Bot.*`，
 * 而且它自带控制台也是改那几个值的地方。Guoba 这时候插手只会造成两套配置打架。
 * 所以只有「装了 QQBot-Plugin 但没装 Web-Adapter」时才由 Guoba 赋值。
 */
export function isQQBotStorageOwnedByGuoba() {
  return hasPlugin('QQBot-Plugin') && !hasPlugin('QQBot-Web-Adapter')
}

let reader = null

/** 懒加载一个带监听的 YamlReader；文件不存在返回 null（YamlReader 读不到文件会直接抛） */
function getReader() {
  if (reader) return reader
  const file = path.join(_paths.root, QQBOT_CONFIG_FILE)
  if (!fs.existsSync(file)) return null
  reader = new YamlReader(file, true)
  return reader
}

/** 读当前值，文件里没写的用默认值补上 */
export function readQQBotStorage() {
  const jsonData = getReader()?.jsonData ?? {}
  const values = {}
  for (const [key, def] of Object.entries(QQBOT_STORAGE_DEFAULTS)) {
    values[key] = jsonData[key] ?? def
  }
  return values
}

/**
 * 把值写到 `Bot.*` 上。QQBot-Plugin 就是读这些全局量决定落不落库、落到哪儿的。
 * @return {boolean} 是否真的赋值了（不归 Guoba 管时返回 false）
 */
export function applyQQBotStorage() {
  if (!isQQBotStorageOwnedByGuoba()) {
    return false
  }
  const values = readQQBotStorage()

  Bot.autoRecordMessage = values.autoRecordMessage !== false
  Bot.autoDownloadImgorVideo = values.autoDownloadImgorVideo !== false
  Bot.saveTimes = [1, 2, 3, 4, 5, 6, 7].includes(values.saveTimes) ? values.saveTimes : 3
  Bot.storageBackend = values.storageBackend === 'sqlite' ? 'sqlite' : 'redis'
  const mcs = Number(values.maxMediaCacheSize)
  Bot.maxMediaCacheSize = (Number.isFinite(mcs) && mcs >= 1 && mcs <= 100) ? Math.floor(mcs) : 10

  return true
}

/**
 * 启动时挂上。
 *
 * 赋值放在 `Bot.once('online')` 而不是插件加载阶段：宿主是**并行**加载插件的
 * （`lib/plugins/loader.js` 里 `Promise.allSettled(files.map(...))`，没有固定顺序），
 * 等所有插件都加载完再赋值，时机才确定。
 *
 * 之后再挂一个文件监听：不管是在面板里保存，还是手改 `config/QQBot.yaml`，
 * 都能立刻重新赋值，不用重启。
 */
export function initQQBotStorage() {
  if (!isQQBotStorageOwnedByGuoba()) {
    return
  }
  Bot.once('online', () => {
    if (applyQQBotStorage()) {
      logger.mark('[Guoba] 已按 config/QQBot.yaml 接管 QQBot 消息存储设置')
    }
  })
  // YamlReader 自己的 change 监听会先重载文档，所以这里读到的已经是新值
  getReader()?.watcher?.on('change', () => applyQQBotStorage())
}
