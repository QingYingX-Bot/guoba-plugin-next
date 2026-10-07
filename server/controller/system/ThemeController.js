import fs from 'fs'
import path from 'path'
import {GuobaError, Result} from '#guoba.framework'
import {ApiController, cfg} from '#guoba.platform'
import {
  BG_ACCEPT_EXTS, THEME_MODES, bgFilePath, deleteBgFile, ensureThemeDir,
  newBgName, normalizeTheme, readTheme, themeDir,
} from '../../utils/themeConfig.js'

/** 单张背景图上限。面板背景图再大也用不到这么大，主要是别让 multer 把磁盘写爆 */
const MAX_BG_SIZE = 20 * 1024 * 1024

/**
 * 面板外观主题。
 */
export default class ThemeController extends ApiController {

  constructor(guobaApp) {
    super('/theme', guobaApp)
  }

  registerRouters() {
    this.get('/', this.getTheme)
    this.put('/', this.saveTheme)
    this.get('/background/image', this.getBackgroundImage)
    this.post('/background', this.uploadBackground)
  }

  getTheme() {
    return Result.ok(readTheme())
  }

  saveTheme(req) {
    const data = normalizeTheme(req.body ?? {})
    const reader = cfg.config.reader
    reader.setData({theme: data})
    for (const legacy of [
      'theme.mode',
      'theme.customCss',
      'theme.cssThemes',
      'theme.activeCssTheme',
    ]) {
      if (reader.has(legacy)) reader.deleteKey(legacy)
    }
    const keep = new Set(THEME_MODES.map((mode) => data.backgrounds[mode]).filter(Boolean))
    const files = fs.existsSync(themeDir) ? fs.readdirSync(themeDir) : []
    for (const name of files) {
      if (!keep.has(name) && bgFilePath(name)) deleteBgFile(name)
    }
    return Result.ok(readTheme(), '已保存')
  }

  getBackgroundImage(req, res) {
    const file = bgFilePath(req.query?.name)
    if (!file || !fs.existsSync(file)) {
      res.status(404).end()
      return Result.VOID
    }
    res.sendFile(file)
    return Result.VOID
  }

  async uploadBackground(req) {
    const mode = String(req.body?.mode ?? '').trim()
    if (!THEME_MODES.includes(mode)) throw new GuobaError('背景图要指明是 dark 还是 light')
    const file = (Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat())[0]
    if (!file) throw new GuobaError('没有收到文件')
    if (Number(file.size ?? 0) > MAX_BG_SIZE) {
      fs.rmSync(file.path, {force: true})
      throw new GuobaError(`图片过大（上限 ${MAX_BG_SIZE / 1024 / 1024}MB）`)
    }
    const ext = path.extname(file.originalname ?? '').slice(1).toLowerCase()
    if (!BG_ACCEPT_EXTS.includes(ext)) {
      fs.rmSync(file.path, {force: true})
      throw new GuobaError(`只支持 ${BG_ACCEPT_EXTS.join(' / ')} 格式的图片`)
    }
    ensureThemeDir()
    const name = newBgName(mode, ext)
    const target = path.join(themeDir, name)
    try {
      await fs.promises.rename(file.path, target)
    } catch {
      await fs.promises.copyFile(file.path, target)
      await fs.promises.unlink(file.path).catch(() => {})
    }
    return Result.ok({name}, '上传成功')
  }

}
