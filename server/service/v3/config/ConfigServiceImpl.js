import lodash from 'lodash'
import {YamlReader} from "#guoba.framework"
import {isTRSS} from '#guoba.adapter'

// 创建可使用相对路径的import方法
const {GI, GID} = Guoba.createImport(import.meta.url)
// 引入模块
const IConfigService = await GID('#/service/interface/IConfigService.js')
const {getConfigReader} = await GI('./utils/ConfigUtils.js')
const {getConfigTabs, configFile, normalizeConfigData} = await GI('./model/useConfig.js')

const CfgUtilsAdapter = await (async () => {
  if (isTRSS) {
    return await GI('./utils/TRSSConfigUtils.js')
  }
  return await GI('./utils/MiaoConfigUtils.js')
})()

export default class ConfigServiceImpl extends IConfigService {

  constructor(app) {
    super(app)
  }

  async getConfigTabs() {
    return getConfigTabs()
  }

  async getConfigData(key) {
    let jsonData = getConfigReader(key, configFile).jsonData
    if (Array.isArray(jsonData)) {
      return jsonData
    }
    const data = normalizeConfigData('get', key, this.handleConfigData('get', key, jsonData))
    const fixed = this.fixIdListConfig(key, data)
    return fixed ? {...data, ...fixed} : data
  }

  async setConfigData(key, data) {
    data = this.handleConfigData('set', key, data)
    getConfigReader(key, configFile).setData(data)
  }

  async removeCardForm(formKey, cardKey) {
    getConfigReader(cardKey, configFile).deleteKey(formKey)
  }

  needHandleConfigKey = [
    'system.other',
    'system.group',
  ]
  needHandleFieldKey = [
    'masterQQ', 'disableAdopt', 'whiteGroup', 'blackGroup', 'blackQQ',
    'whiteQQ', 'blackUser', 'whiteUser', 'botAlias', 'enable', 'disable',
  ]
  // 这些字段存的是 QQ 号/群号列表，宿主判定用的是 includes(Number(e.user_id))。
  // 落盘成字符串（yaml 会输出 - "123"）就永远匹配不上数字，等于没配。
  needNumericFieldKey = [
    'blackUser', 'whiteUser', 'blackQQ', 'whiteQQ', 'blackGroup', 'whiteGroup',
  ]

  isIdListField(key, field) {
    return this.needHandleConfigKey.includes(key) && this.needNumericFieldKey.includes(field)
  }

  // 纯数字字符串转数字，带平台前缀之类的值原样保留
  toIdList(value) {
    if (!Array.isArray(value)) {
      return value
    }
    return value.map(item => {
      if (typeof item !== 'string') {
        return item
      }
      const str = item.trim()
      return /^\d+$/.test(str) ? Number(str) : item
    })
  }

  /**
   * 老配置里黑白名单被存成了带引号的字符串，宿主按数字比对永远不命中。
   * 读到就顺手改成数字写回，省得用户再重新保存一遍。
   */
  fixIdListConfig(key, data) {
    if (!data || typeof data !== 'object') {
      return null
    }
    const patch = {}
    for (const [field, value] of Object.entries(data)) {
      if (!this.isIdListField(key, field) || !Array.isArray(value)) {
        continue
      }
      const fixed = this.toIdList(value)
      if (fixed.some((item, i) => item !== value[i])) {
        patch[field] = fixed
      }
    }
    if (Object.keys(patch).length === 0) {
      return null
    }
    try {
      getConfigReader(key, configFile).setData(patch)
    } catch (e) {
      logger.error('[Guoba] 黑白名单配置修正失败')
      logger.error(e)
      return null
    }
    return patch
  }

  /**
   * 处理配置里可能出现的特殊数据（空值等）
   */
  handleConfigData(action, key, data) {
    if (!data || Array.isArray(data)) {
      return data
    }
    const handler = (itemData) => {
      let newData = {}
      for (let [oKey, oVal] of Object.entries(itemData || {})) {
        let field = oKey
        let value = oVal

        if (action === 'get') {
          // 此处特殊处理，因为前端form的field不能是纯数字，只处理一层
          if (/^\d+$/.test(field)) {
            field = YamlReader.CONFIG_INTEGER_KEY + field
          }
        }

        // 处理空值
        if (this.needHandleConfigKey.includes(key) && this.needHandleFieldKey.includes(oKey)) {
          if (value == null || value === '') {
            value = []
          }
          if (Array.isArray(value)) {
            value = value.filter(str => str != null && str !== '')
          }
        }

        // 黑白名单必须写成纯数字，见 needNumericFieldKey
        if (action === 'set' && this.isIdListField(key, oKey)) {
          value = this.toIdList(value)
        }

        // 特殊处理
        const handleRes = CfgUtilsAdapter.handleConfigData(action, key, field, value)
        field = handleRes.field
        value = handleRes.value

        if (action === 'get') {
          newData[field] = value
        } else {
          lodash.set(newData, field, value)
        }
      }
      return newData
    }

    if (key === 'system.group') {
      let obj = handler(data)
      obj = CfgUtilsAdapter.handleGroupConfig(action, obj)
      for (let [oKey, oVal] of Object.entries(obj)) {
        obj[oKey] = handler(oVal)
      }
      return obj
    }
    return handler(data)
  }

}
