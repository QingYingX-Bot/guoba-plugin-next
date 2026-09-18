import fs from 'fs'
import path from 'path'
import {pathToFileURL} from 'url'
import lodash from 'lodash'
import moment from 'moment'
import {GuobaError} from "#guoba.framework";
import {_paths} from '#guoba.platform'
import {getRenderer, moveFile} from '#guoba.utils'

const {GID} = Guoba.createImport(import.meta.url)
const IMiaoPluginService = await GID('./IMiaoPluginService.js')

// noinspection JSUnusedGlobalSymbols
/**
 * 喵喵最新版
 */
export default class MiaoPluginService extends IMiaoPluginService {
  constructor(app) {
    super(app)
  }

  _miaoPath = null

  get miaoPath() {
    if (this._miaoPath) {
      return this._miaoPath
    }
    let miaoPath = path.join(_paths.root, 'plugins/miao-plugin')
    let helpPath = path.join(miaoPath, 'resources/help')
    let helpCfgPath = path.join(miaoPath, 'config/help.js')

    let themePath = path.join(miaoPath, 'resources/help/theme')
    let iconPath = path.join(helpPath, 'icon.png')

    let themeDefaultPath = path.join(themePath, 'default')

    return this._miaoPath = {
      miaoPath, helpPath,
      helpCfgPath,
      themePath, iconPath,
      themeDefaultPath,
    }
  }

  _miaoUtils = null

  async getMiaoUtils() {
    if (this._miaoUtils) {
      return this._miaoUtils
    }
    return this._miaoUtils = {
      Data: (await this.importMiao(['../../../../../../miao-plugin/components/Data.js'])).default,
      // Theme: (await this.importMiao([
      //   '../../../../../../miao-plugin/apps/help/HelpTheme.js',
      //   '../../../../../../miao-plugin/apps/help/theme.js',
      // ])).default,
    }
  }

  async importMiao(paths, errorTip = '当前版本的喵喵插件暂不支持，请联系锅巴作者尽快修复！') {
    for (let p of paths) {
      try {
        return await import(p)
      } catch (e) {
        logger.error(e.message || e)
      }
    }
    throw new GuobaError(errorTip)
  }

  initBackup() {
  }

  async getHelpSetting() {
    let {Data} = await this.getMiaoUtils()
    let {sysCfg, diyCfg} = await Data.importCfg('help')
    let {helpPath} = this.miaoPath

    // 兼容老配置
    let custom, help = {}
    if (fs.existsSync(`${helpPath}/help-cfg.js`)) {
      help = await import(`file://${helpPath}/help-cfg.js?version=${new Date().getTime()}`)
    } else if (fs.existsSync(`${helpPath}/help-list.js`)) {
      help = await import(`file://${helpPath}/help-list.js?version=${new Date().getTime()}`)
    }
    // 兼容一下旧字段
    if (lodash.isArray(help.helpCfg)) {
      custom = {
        helpList: help.helpCfg,
        helpCfg: {},
      }
    } else {
      custom = help
    }

    let helpCfg = lodash.defaults(
      diyCfg.helpCfg || {}, custom.helpCfg, sysCfg.helpCfg,
      // ----- 兼容喵喵字段问题 ------
      {colCount: 3, bgBlur: true},
      // ---------------------------
    )
    let helpList = diyCfg.helpList || custom.helpList || sysCfg.helpList
    let themeNames = this.getThemeNames()
    return {helpCfg, helpList, themeNames}
  }

  /** Yunzai Runtime 类缓存 */
  _yunzaiRuntimeClass = undefined

  /**
   * 取 Yunzai 的 Runtime 类。
   *
   * 预览复用喵喵自己的出图链路（runtime.render → beforeRender → puppeteer），
   * 布局、缩放、资源路径才和群里那张图一字不差。Runtime 构造只存 e，不依赖真实消息事件；
   * 主进程已经按同一 URL 加载过这个模块，再 import 拿到的是同一份，不会重复求值。
   */
  async getYunzaiRuntimeClass() {
    if (this._yunzaiRuntimeClass) {
      return this._yunzaiRuntimeClass
    }
    let file = path.join(_paths.root, 'lib/plugins/runtime.js')
    let mod = await import(pathToFileURL(file).href)
    return (this._yunzaiRuntimeClass = mod.default)
  }

  /** 解析前端传来的草稿 JSON，坏数据不让预览整个挂掉 */
  parseDraftJson(raw, fallback) {
    if (typeof raw !== 'string' || !raw.trim()) {
      return fallback
    }
    try {
      let parsed = JSON.parse(raw)
      return parsed ?? fallback
    } catch (e) {
      throw new GuobaError('草稿格式有误，无法生成预览')
    }
  }

  /**
   * 用编辑器的草稿出一张预览图（不落盘、不发消息）。
   *
   * 渲染完全走喵喵那一套：模板、皮肤、缩放、分栏都由它自己决定，这里只把
   * 「要渲染的内容」从磁盘上的 config/help.js 换成传进来的草稿。用 retType=base64
   * 直接拿图，所以 e 只需要挂个 runtime，图不会进任何聊天。
   *
   * @param bodyParams {{helpCfg?: string, helpList?: string}} 前端传来的 JSON 字符串
   * @return {Promise<any>} 处理好的图片数据
   */
  async renderHelpPreview(bodyParams) {
    let {helpCfg: cfgRaw, helpList: listRaw} = (bodyParams || {})
    let draftCfg = this.parseDraftJson(cfgRaw, {})
    let draftList = this.parseDraftJson(listRaw, [])
    if (!Array.isArray(draftList) || draftList.length === 0) {
      throw new GuobaError('帮助列表还是空的，先加几条命令再预览')
    }

    let renderer = await getRenderer()
    if (!renderer) {
      throw new GuobaError('当前环境没有可用的图片渲染器，无法生成预览')
    }

    let {Data} = await this.getMiaoUtils()
    let {sysCfg} = await Data.importCfg('help')

    // 与 Help.render 一致：草稿 → 系统配置兜底，再补喵喵自身缺省的那两项
    let helpConfig = lodash.defaults(
      {...draftCfg},
      sysCfg.helpCfg,
      {colCount: 3, bgBlur: true},
    )

    // 与 Help.render 一致：把 icon 序号换算成雪碧图偏移，0 表示这条不显示图标
    let helpGroup = []
    lodash.forEach(draftList, (group) => {
      lodash.forEach(group?.list, (item) => {
        let icon = item.icon * 1
        if (!icon) {
          item.css = 'display:none'
        } else {
          let x = (icon - 1) % 10
          let y = (icon - x - 1) / 10
          item.css = `background-position:-${x * 50}px -${y * 50}px`
        }
      })
      helpGroup.push(group)
    })

    let HelpTheme = (await this.importMiao([
      '../../../../../../miao-plugin/apps/help/HelpTheme.js',
    ])).default
    let themeData = await HelpTheme.getThemeData(draftCfg, sysCfg.helpCfg || {})

    let MiaoRender = (await this.importMiao([
      '../../../../../../miao-plugin/components/common/Render.js',
    ])).default
    let Runtime = await this.getYunzaiRuntimeClass()

    let img
    try {
      img = await MiaoRender.render('help/index', {
        helpCfg: helpConfig,
        helpGroup,
        ...themeData,
        element: 'default',
        // 独立的 html 文件名。宿主渲染是「先写 temp/html 再截图」，跟群聊里的 #帮助
        // 共用名字的话两边并发会互相覆盖，谁后写谁的内容就跑到别人图里。
        // 只改文件名、不改目录层级，所以 _res_path 那套相对路径不受影响
        saveId: 'help-preview',
      }, {e: {runtime: new Runtime({})}, scale: 1.2, retType: 'base64'})
    } catch (err) {
      logger.error('[Guoba] 喵喵帮助预览出图失败')
      logger.error(err)
      throw new GuobaError('预览生成失败，请查看后台日志')
    }
    let dataUrl = this.toImageDataUrl(img)
    if (!dataUrl) {
      throw new GuobaError('预览生成失败，请查看后台日志')
    }
    return dataUrl
  }

  /**
   * 把出图结果转成 dataURL，方便前端直接塞进 <img>。
   *
   * puppeteer.screenshot 返回的是 segment.image 包装过的东西，各家宿主形态不一
   * （base64 串、`base64://` 前缀、Buffer、带 file 字段的对象），这里只做宽容归一，
   * 认不出来就返回空串让调用方当失败处理 —— 绝不猜格式硬转。
   */
  toImageDataUrl(img) {
    if (!img) {
      return ''
    }
    let raw = img
    if (typeof raw === 'object' && !Buffer.isBuffer(raw)) {
      raw = raw.file ?? raw.data ?? raw.buffer
    }
    if (Buffer.isBuffer(raw)) {
      return `data:image/jpeg;base64,${raw.toString('base64')}`
    }
    if (typeof raw === 'string') {
      let text = raw.trim()
      if (text.startsWith('data:')) {
        return text
      }
      text = text.replace(/^base64:\/\//, '').replace(/\s/g, '')
      // 纯 base64 串才认：长度够、字符集干净
      if (text.length > 100 && /^[A-Za-z0-9+/=]+$/.test(text)) {
        return `data:image/jpeg;base64,${text}`
      }
    }
    return ''
  }

  getThemeNames() {
    let {themePath} = this.miaoPath
    let names = []
    let dirs = fs.readdirSync(themePath)
    lodash.forEach(dirs, (dir) => {
      if (fs.existsSync(path.join(themePath, dir, `main.png`))) {
        names.push(dir)
      }
    })
    return names
  }

  saveHelpSetting(bodyParams, files) {
    let {helpCfg, helpList} = bodyParams
    helpCfg = JSON.parse(helpCfg)
    if (Array.isArray(helpCfg.theme) && helpCfg.theme.length === 0) {
      helpCfg.theme = 'all'
    }
    let {helpCfgPath, iconPath} = this.miaoPath
    let content = `export const helpCfg = ${JSON.stringify(helpCfg, null, 2)}\n`
    content += `export const helpList = ${helpList}`
    fs.writeFileSync(helpCfgPath, content, 'utf-8')
    if (Array.isArray(files) && files.length > 0) {
      let [iconFile] = files
      moveFile(iconFile.path, iconPath)
    }
  }

  async getHelpThemeList() {
    let themeNames = this.getThemeNames()
    themeNames = themeNames.sort((a, b) => {
      if (b === 'default') {
        return -1
      }
      return a.localeCompare(b)
    })
    let list = []
    for (const themeName of themeNames) {
      let style = await this.getHelpThemeConfig({themeName})
      list.push({name: themeName, style})
    }
    return list
  }

  async getHelpThemeConfig(params) {
    let {themeName} = (params || {})
    if (!themeName) themeName = 'default'
    let {Data} = await this.getMiaoUtils()
    let themeConfigPath = path.join(this.miaoPath.themePath, themeName, 'config.js')
    if (!fs.existsSync(themeConfigPath)) {
      themeName = 'default'
    }
    return (await Data.importModule(`resources/help/theme/${themeName}/config.js`, 'miao')).style || {}
  }

  async saveHelpThemeConfig(params) {
    let {themeName, config} = (params || {})
    if (!themeName) themeName = 'default'
    if (themeName === 'default') {
      throw new GuobaError('默认皮肤不可修改！')
    }
    let {Data} = await this.getMiaoUtils()
    let defaultStyle = (await Data.importModule(`resources/help/theme/default/config.js`)).style || {}
    let themeStyle = (await Data.importModule(`resources/help/theme/${themeName}/config.js`)).style || {}
    let merge = lodash.merge({}, defaultStyle, themeStyle, config)
    let content = `export const style = ${JSON.stringify(merge, null, 2)}`
    let savePath = path.join(this.miaoPath.themePath, themeName, 'config.js')
    fs.writeFileSync(savePath, content, 'utf-8')
  }

  async addHelpTheme(params, files) {
    let {themeName} = params
    let [mainPic] = files
    let themePath = path.join(this.miaoPath.themePath, themeName)
    if (fs.existsSync(themePath)) {
      throw new GuobaError(`${themeName} 已存在！`)
    }
    fs.mkdirSync(themePath)
    let mainImgPath = path.join(themePath, 'main.png')
    moveFile(mainPic.path, mainImgPath)
  }

  async editHelpTheme(params, files) {
    let {themeName} = params
    let [mainPic] = files
    let themePath = path.join(this.miaoPath.themePath, themeName)
    if (!fs.existsSync(themePath)) {
      throw new GuobaError(`${themeName} 不存在！`)
    }
    let mainImgPath = path.join(themePath, 'main.png')
    moveFile(mainPic.path, mainImgPath)
  }

  async deleteHelpTheme(params) {
    let {themeName} = params
    if (!themeName) {
      throw new GuobaError(`themeName 必须填写！`)
    }
    if (themeName === 'default') {
      throw new GuobaError(`默认皮肤不可删除！`)
    }
    let themePath = path.join(this.miaoPath.themePath, themeName)
    fs.rmSync(themePath, {recursive: true})
  }

  /**
   * 获取皮肤main.png路径
   * @return {*}
   */
  getThemeMainPath(query) {
    let {themeName} = (query || {})
    if (!themeName) themeName = 'default'
    let themeMainPath = path.join(this.miaoPath.themePath, themeName, 'main.png')
    if (fs.existsSync(themeMainPath)) {
      return themeMainPath
    }
    return path.join(this.miaoPath.themeDefaultPath, 'main.png')
  }

  /**
   * 获取皮肤bg路径
   * @return {*}
   */
  getThemeBgPath() {
    return path.join(this.miaoPath.themeDefaultPath, 'bg.jpg')
  }

  getBackupCfg() {
    let backCfg = super.getBackupCfg()
    let {backupList} = backCfg
    backupList.forEach((item) => {
      if (item.version !== 2) {
        item.version = 1
      }
    })
    return backCfg
  }

  addBackup(remark) {
    let {backupPath, backupList, save} = this.getBackupCfg()
    let {helpCfgPath, iconPath} = this.miaoPath
    if (!fs.existsSync(helpCfgPath)) {
      throw new GuobaError('未检测到配置文件，请先保存一次即可正常使用备份功能')
    }
    let id = new Date().getTime().toString()
    backupList.push({id, remark, time: moment().format('YYYY-MM-DD HH:mm:ss'), version: 2})
    let backupDir = path.join(backupPath, id)
    fs.mkdirSync(backupDir)
    fs.cpSync(iconPath, path.join(backupDir, path.basename(iconPath)))
    fs.cpSync(helpCfgPath, path.join(backupDir, path.basename(helpCfgPath)))
    save()
    return true
  }

  async restoreBackup(id) {
    let backupCfg = this.getBackupCfg()
    let item = backupCfg.find(id)
    if (!item) {
      throw new GuobaError('backup not found')
    }
    if (item.version !== 2) {
      await this.convertBackup(item)
    }
    let {helpCfgPath, iconPath} = this.miaoPath
    let backupDir = path.join(backupCfg.backupPath, id)
    fs.cpSync(path.join(backupDir, path.basename(iconPath)), iconPath)
    fs.cpSync(path.join(backupDir, path.basename(helpCfgPath)), helpCfgPath)
    return true
  }

  async convertBackup(backItem) {
    let {themePath} = this.miaoPath
    let {backupPath, save} = this.getBackupCfg()
    let backupDir = path.join(backupPath, backItem.id)
    // 将配置文件转为新格式
    let oldCfgPath = path.join(backupDir, 'help-cfg.js')
    if (!fs.existsSync(oldCfgPath)) {
      throw new GuobaError('该备份已损坏，无法转换并恢复')
    }
    let {Data} = await this.getMiaoUtils()
    let defCfg
    try {
      defCfg = await Data.importModule(`config/help_default.js`)
    } catch (e) {
      defCfg = await Data.importModule(`config/system/help_system.js`)
    }
    if (!defCfg) {
      throw new GuobaError('转换失败，请勿删除默认配置文件')
    }
    let oldCfg = await Data.importModule('help-cfg.js', backupDir)
    // 兼容一下旧字段
    let customCfg
    if (lodash.isArray(oldCfg.helpCfg)) {
      customCfg = {
        helpList: oldCfg.helpCfg,
        helpCfg: {},
      }
    } else {
      customCfg = oldCfg
    }
    let helpCfg = lodash.defaults(customCfg.helpCfg || {}, defCfg.helpCfg)
    let helpList = customCfg.helpList || defCfg.helpList
    let mainImgPath = path.join(backupDir, 'main-01.png')
    // 将背景图片转为皮肤
    if (fs.existsSync(mainImgPath)) {
      let themeName = backItem.remark
      let themeDir = path.join(themePath, themeName)
      let count = 0
      while (fs.existsSync(themeDir)) {
        if (count++ > 10) {
          throw new GuobaError('转换失败，皮肤名称重复')
        }
        themeName += '_' + lodash.random(100, 999)
        themeDir = path.join(themePath, themeName)
      }
      fs.mkdirSync(themeDir)
      moveFile(mainImgPath, path.join(themeDir, 'main.png'))
      // 指定为转换后的皮肤
      helpCfg.theme = [themeName]
    }
    // 保存新配置
    let newHelpPath = path.join(backupDir, 'help.js')
    let content = `export const helpCfg = ${JSON.stringify(helpCfg, null, 2)}\n`
    content += `export const helpList = ${JSON.stringify(helpList, null, 2)}`
    fs.writeFileSync(newHelpPath, content, 'utf-8')
    backItem.version = 2
    delete backItem.isInit
    save()
    // 删除旧配置
    fs.unlinkSync(oldCfgPath)
  }

  deleteBackup(id) {
    let {backupPath, backupList, save} = this.getBackupCfg()
    let backupDir = path.join(backupPath, id)
    fs.rmSync(backupDir, {recursive: true})
    lodash.remove(backupList, {id})
    save()
    return true
  }

}
