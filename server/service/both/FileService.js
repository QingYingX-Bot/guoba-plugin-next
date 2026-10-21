import path from 'node:path'
import fs from 'node:fs'
import {GuobaError, Service} from '#guoba.framework'
import {_paths, cfg} from '#guoba.platform'
import {dirStats, walkDir} from '../../utils/fsWalk.js'
import {createZipStream} from '../../utils/zip.js'

/** 文本文件超过这个大小就不在页面里编辑，提示用下载 */
const MAX_TEXT_SIZE = 2 * 1024 * 1024
/** 上传单文件上限 */
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024
/** 读文件前多少字节嗅探二进制（含 \0 就按二进制处理） */
const BINARY_SNIFF = 4096
/** 面板默认允许写入的根内目录；配置里填 '*' 表示整个云崽目录都可写 */
const DEFAULT_WRITE_SCOPES = ['data', 'logs', 'temp']

/**
 * 文件管理。
 *
 * 面板主人要在网页里直接看 / 改 Yunzai 目录下的文件，不必每次上服务器。与老的全盘文件树
 * （/sys/fs/tree/*，Linux 下直接挂 /）不同，这里**限定在 Yunzai 根目录内**：
 * 入参一律是相对根目录的路径（根本身传空串），后端解析后校验没越界才放行。
 */
export default class FileService extends Service {

  /**
   * @param {object} guobaApp
   * @param {string} [root] 根目录，默认取 Yunzai 根（测试时传入临时目录）
   */
  constructor(guobaApp, root) {
    super(guobaApp)
    this.root = root || _paths.root
  }

  /** 相对路径解析为根内绝对路径，越界直接报错 */
  #resolve(rel = '') {
    const clean = String(rel ?? '').trim().replace(/^\/+/, '')
    const abs = path.resolve(this.root, clean)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new GuobaError('路径越界')
    }
    return abs
  }

  /**
   * 文件名清洗：去掉路径分隔符，并把 Windows 的非法字符（`<>:"/\|?*` 及控制字符）
   * 换成下划线 —— 文件管理要能跑在 Windows 上，这些字符建不出文件。
   * 仍以 `..` 开头的名字由调用方拒绝。
   */
  #sanitizeName(name) {
    return String(name ?? '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .trim()
  }

  /** 相对路径拆段（兼容两种分隔符），取 basename 名并清洗后重组 */
  #sanitizeRel(rel) {
    const parts = String(rel ?? '').replace(/[\\/]+/g, '/').split('/').filter(Boolean)
    const raw = parts.pop() ?? ''
    const name = this.#sanitizeName(raw)
    if (!name) throw new GuobaError('名称不合法')
    return [...parts, name].join('/')
  }

  /** 面板允许写入的根内目录（可配置），默认只有 data / logs / temp；'*' 表示全部 */
  #writeScopes() {
    const configured = cfg.get('security.fileWriteScopes')
    const list = Array.isArray(configured) ? configured : DEFAULT_WRITE_SCOPES
    return list
      .map(item => String(item ?? '').replace(/^[\/]+|[\/]+$/g, ''))
      .filter(Boolean)
  }

  /** 已存在路径的真实位置必须仍在根内，防止符号链接把请求带到根外 */
  #assertRealWithinRoot(abs) {
    let probe = abs
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe)
      if (parent === probe) return
      probe = parent
    }
    const realRoot = fs.realpathSync(this.root)
    const real = fs.realpathSync(probe)
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new GuobaError('路径越界')
    }
  }

  /**
   * 写操作的双重校验：真实路径在根内 + 落在允许写入的目录里。
   *
   * 只靠「在 Yunzai 根内」挡不住提权：往 plugins/ 写一个 js 文件就等于执行代码。
   * 所以写入默认只开放 data / logs / temp，其余目录一律只读。
   */
  #assertWritable(abs) {
    this.#assertRealWithinRoot(abs)
    const rel = path.relative(this.root, abs)
    if (!rel) throw new GuobaError('不能直接修改根目录')
    const scopes = this.#writeScopes()
    // '*' = 整个云崽目录都可写；根外路径和符号链接仍由 #assertRealWithinRoot 拦住
    if (scopes.includes('*')) return
    const top = rel.split(path.sep)[0]
    if (!scopes.includes(top)) {
      throw new GuobaError(`为安全起见，面板只允许写入 ${scopes.join(' / ')} 目录`)
    }
  }

  /** 列目录：文件夹在前、按名称排，无权限的项跳过 */
  list(rel = '') {
    const dir = this.#resolve(rel)
    if (!fs.existsSync(dir)) throw new GuobaError('目录不存在')
    if (!fs.statSync(dir).isDirectory()) throw new GuobaError('不是目录')
    const out = []
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name)
      let stat
      try {
        stat = fs.statSync(abs)
      } catch {
        continue
      }
      out.push({
        name,
        isDir: stat.isDirectory(),
        size: stat.isDirectory() ? 0 : stat.size,
        mtime: Math.floor(stat.mtimeMs / 1000),
      })
    }
    out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)))
    return out
  }

  /** 读文本文件，过大 / 二进制拒绝（提示用下载） */
  read(rel = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new GuobaError('文件不存在')
    const size = fs.statSync(abs).size
    if (size > MAX_TEXT_SIZE) throw new GuobaError('文件过大，无法在页面编辑，请下载后查看')
    const head = Buffer.alloc(Math.min(size, BINARY_SNIFF))
    const fd = fs.openSync(abs, 'r')
    fs.readSync(fd, head, 0, head.length, 0)
    fs.closeSync(fd)
    if (head.includes(0)) throw new GuobaError('这是二进制文件，不支持在页面编辑')
    return {content: fs.readFileSync(abs, 'utf8'), size}
  }

  /** 写回文本文件 */
  save(rel = '', content = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new GuobaError('文件不存在')
    this.#assertWritable(abs)
    fs.writeFileSync(abs, String(content ?? ''), 'utf8')
    return {ok: true}
  }

  /** 新建文件夹 */
  mkdir(rel = '') {
    const abs = this.#resolve(this.#sanitizeRel(rel))
    if (fs.existsSync(abs)) throw new GuobaError('目录已存在')
    this.#assertWritable(abs)
    fs.mkdirSync(abs)
    return {ok: true}
  }

  /** 新建文件 */
  create(rel = '', content = '') {
    const abs = this.#resolve(this.#sanitizeRel(rel))
    if (fs.existsSync(abs)) throw new GuobaError('文件已存在')
    this.#assertWritable(abs)
    fs.writeFileSync(abs, String(content ?? ''), 'utf8')
    return {ok: true}
  }

  /** 重命名。newName 清洗分隔符与 Windows 非法字符，仍以 .. 开头的名字直接拒绝 */
  rename(rel = '', newName = '') {
    const name = this.#sanitizeName(newName)
    if (!name || name === '.' || name === '..' || name.startsWith('..')) throw new GuobaError('文件名不合法')
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs)) throw new GuobaError('源不存在')
    const target = this.#resolve(path.posix.join(path.posix.dirname(rel), name))
    if (fs.existsSync(target)) throw new GuobaError('同名文件已存在')
    this.#assertWritable(abs)
    this.#assertWritable(target)
    fs.renameSync(abs, target)
    return {ok: true}
  }

  /** 删除文件或文件夹（递归） */
  remove(rel = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs)) throw new GuobaError('不存在')
    this.#assertWritable(abs)
    fs.rmSync(abs, {recursive: true, force: true})
    return {ok: true}
  }

  /**
   * 上传。multer 已把 multipart 文件落盘到临时目录，这里搬进目标目录；
   * 文件名清洗掉路径分隔符（防 ../ 覆盖根外文件），重名自动加后缀。
   */
  /**
   * 上传文件到 `rel` 目录。
   *
   * `relPaths` 是「上传整个文件夹」时前端带过来的相对路径（如 `我的插件/sub/a.js`），
   * 与 files 按下标一一对应。有它就在目标目录下按这些相对路径建子目录，
   * 每条路径都会被逐段清洗并校验没有越出目标目录 —— 浏览器给的相对路径不可信。
   */
  async upload(rel = '', files = [], relPaths = []) {
    const dir = this.#resolve(rel)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new GuobaError('目标目录不存在')
    this.#assertWritable(dir)
    const list = Array.isArray(files) ? files : [files]
    if (!list.length) throw new GuobaError('没有收到文件')
    const relList = Array.isArray(relPaths) ? relPaths : []
    const saved = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (!f?.path || !f?.originalname) continue
      const size = Number(f.size ?? 0)
      if (size > MAX_UPLOAD_SIZE) {
        fs.rmSync(f.path, {force: true})
        throw new GuobaError(`文件过大（上限 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB）`)
      }
      const safeName = this.#sanitizeName(f.originalname)
      if (!safeName || safeName === '.' || safeName === '..' || safeName.startsWith('..')) {
        fs.rmSync(f.path, {force: true})
        throw new GuobaError('文件名不合法')
      }
      // 上传文件夹时按相对路径落进对应子目录；单文件上传时 relPaths 为空，就是 dir 本身
      const targetDir = this.#resolveUploadDir(dir, relList[i])
      await fs.promises.mkdir(targetDir, {recursive: true})
      const ext = path.extname(safeName)
      let target = path.join(targetDir, safeName)
      if (fs.existsSync(target)) {
        target = path.join(targetDir, `${path.basename(safeName, ext)}-${Date.now().toString(36)}${ext}`)
      }
      try {
        await fs.promises.rename(f.path, target)
      } catch {
        // 跨文件系统时 rename 会失败，退回复制 + 删临时
        await fs.promises.copyFile(f.path, target)
        await fs.promises.unlink(f.path).catch(() => {})
      }
      saved.push(path.relative(dir, target).split(path.sep).join('/'))
    }
    return {ok: true, saved}
  }

  /**
   * 把上传时的相对路径换算成目标目录（只取目录部分，文件名由 originalname 决定）。
   * 逐段清洗，`..` / 绝对路径一律拒绝，最后再校验解析结果确实在 baseDir 里面。
   */
  #resolveUploadDir(baseDir, relPath) {
    const raw = String(relPath ?? '').replace(/[\/]+/g, '/').trim()
    if (!raw) return baseDir
    const segments = raw.split('/').filter(Boolean)
    // 最后一段是文件名，目录部分才是要建的
    segments.pop()
    const clean = []
    for (const seg of segments) {
      const name = this.#sanitizeName(seg)
      if (!name || name === '.' || name === '..') throw new GuobaError('文件夹名不合法')
      clean.push(name)
    }
    if (!clean.length) return baseDir
    const abs = path.resolve(baseDir, ...clean)
    if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) {
      throw new GuobaError('上传路径越界')
    }
    return abs
  }

  /** 下载：返回根内绝对路径，由 controller 交给 res.download */
  downloadAbs(rel = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new GuobaError('文件不存在')
    return abs
  }

  /**
   * 算文件夹占用。列目录时不做这件事 —— `node_modules` 之类一层就得走十万个 inode，
   * 每次进目录都算一遍页面就废了，所以做成用户点一下才算的接口。
   *
   * 撞上条目数 / 时间上限会带 `partial: true` 返回已经数到的部分，让页面标出「≥」，
   * 而不是干等到超时或者报个错。
   */
  async dirSize(rel = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new GuobaError('目录不存在')
    return dirStats(abs)
  }

  /**
   * 打包文件夹下载：返回 {name, stream}，stream 由 controller 直接 pipe 给响应。
   *
   * 全程流式，不落临时文件（见 createZipStream）。包内会多一层跟文件夹同名的目录，
   * 解出来就是一个完整文件夹，不会把几万个文件散在下载目录里。
   */
  zipDir(rel = '') {
    const abs = this.#resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new GuobaError('目录不存在')
    // 根目录没有 basename，用 Yunzai 兜底
    const base = abs === this.root ? 'Yunzai' : path.basename(abs)
    const entries = (async function* () {
      // 顶层目录自己也要有条目，不然包里只有它的子项
      yield {name: base, isDir: true, size: 0, mtimeMs: Date.now(), mode: 0o755}
      for await (const entry of walkDir(abs)) {
        yield {...entry, name: `${base}/${entry.rel}`}
      }
    })()
    return {name: `${base}.zip`, stream: createZipStream(entries)}
  }
}
