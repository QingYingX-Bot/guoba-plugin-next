import fs from 'fs'
import os from 'os'
import path from 'path'
import {exec} from 'child_process'
import {cfg} from '#guoba.platform'

/**
 * git工具类
 */
export default class GitTools {

  static STATUS = {
    ERROR: -1,
    OK: 0,
    AUTH_ERROR: -2,
  }

  static CHECK_STATUS = {
    NOT_EXIST: 1,
    NOT_MATCH: 2,
  }

  static PULL_STATUS = {
    UP_TO_DATE: 0,
  }

  /**
   * 当前仓库是否存在错误
   * @type {boolean}
   */
  repoIsError = false

  /**
   *
   * @param directory 本地目录
   * @param repository 仓库地址
   * @param options 配置
   */
  constructor(directory, repository, options) {
    this.name = path.basename(directory)
    this.directory = directory
    this.repository = repository

    this.options = Object.assign({}, {
      // 严格模式，如果仓库不存在或者不是指定仓库，会删除目录重新克隆
      strictMode: false,
      // 是否在初始化时立即克隆
      immediateClone: false,
      // 备用链接
      fallbackUrl: null 
    }, options)

    if (this.options.immediateClone) {
      this.initPromise = this.init()
    }
  }

  async init() {
    // logger.debug(`[Guoba] 开始执行 "${this.name}" 仓库的初始化操作： ${this.directory} `)

    // isGitAvailable 已尝试过「探测 + 找不到就补 PATH 再探」，走到这儿说明常见安装位置也没找到，
    // 基本就是真没装。这俩仓库是可选资源，缺了不影响锅巴主体，静默降级成一条提示，别刷红也别抛异常。
    if (!(await GitTools.isGitAvailable())) {
      this.repoIsError = true
      if (!GitTools._gitMissingWarned) {
        GitTools._gitMissingWarned = true
        const tip = `[Guoba] 未找到可用的 git，已跳过资源仓库(插件索引/资源库)的下载与更新，插件索引/备份还原等功能暂不可用。请安装 git（若已装在非常见目录，可将其加入系统 PATH）后重启。`
        if (typeof logger !== 'undefined') logger.warn(tip)
        else console.warn(tip)
      }
      return
    }

    let checkRes
    try {
      checkRes = await this.checkRepo()
    } catch (err) {
      // checkRepo 在 git remote -v 失败时会 throw；init 是游离 promise，兜住避免 unhandledRejection
      this.repoIsError = true
      logger.error(`[Guoba] 检查 "${this.name}" 仓库状态时出错：${err?.message || err}`)
      return
    }
    if (checkRes === GitTools.CHECK_STATUS.NOT_EXIST) {
      const res = await this.cloneRepo()
      if (res.status !== GitTools.STATUS.OK) {
        logger.error(`[Guoba] 执行 "${this.name}" 仓库的clone操作时出现错误；stderr: ${res.stderr}`)
      }
    } else if (checkRes === GitTools.CHECK_STATUS.NOT_MATCH) {
      if (this.options.strictMode) {
        logger.warn(`[Guoba] 检测到 "${this.name}" 仓库损坏，执行删除并重新克隆操作`)
        await this.forceReClone()
      } else {
        logger.error(`[Guoba] 检测到 "${this.name}" 仓库损坏，非严格模式下不执行任何操作`)
        this.repoIsError = true
      }
    } else if (checkRes === GitTools.STATUS.OK) {
      const res = await this.pull()
      if (res.status === GitTools.STATUS.AUTH_ERROR) {
        logger.warn(`[Guoba] "${this.name}" 仓库更新被跳过(需账号验证且无备用链接)，直接保留并使用本地现有缓存。`)
      } else if (res.status === GitTools.STATUS.ERROR) {
        if (this.options.strictMode) {
          logger.warn(`[Guoba] 检测到 "${this.name}" 仓库损坏，执行删除并重新克隆操作`)
          await this.forceReClone()
        } else {
          logger.error(`[Guoba] 执行 "${this.name}" 仓库的pull操作时出现错误；stderr: ${res.stderr}`)
        }
      }
    }
  }

  async forceReClone() {
    const rmSync = fs.rmSync || fs.rmdirSync
    rmSync(this.directory, {recursive: true, force: true})
    const res = await this.cloneRepo()
    if (res.status === GitTools.STATUS.OK) {
      this.repoIsError = false
    } else {
      logger.warn(`[Guoba] 执行 "${this.name}" 仓库的强制重新Clone操作时出现错误，请手动删除 "${this.directory}" 目录并重启；stderr: ${res.stderr}`)
    }
    return res
  }

  /**
   * 检查仓库是否存在
   */
  async checkRepo() {
    const dirIsExist = fs.existsSync(this.directory)
    if (!dirIsExist) {
      return GitTools.CHECK_STATUS.NOT_EXIST
    }
    const gitIsExist = fs.existsSync(path.join(this.directory, '.git'))
    if (!gitIsExist) {
      return GitTools.CHECK_STATUS.NOT_MATCH
    }
    const res = await this.exec(`git -C "${this.directory}" remote -v`)
    if (res.error) {
      throw new Error(res.stderr)
    }
    if (res.stdout.includes(this.repository)) {
      return GitTools.STATUS.OK
    }
    return GitTools.CHECK_STATUS.NOT_MATCH
  }

  // 内部辅助方法：处理代理拼接
  _getProxyUrl(repoUrl) {
    const githubReverseProxy = cfg.get('base.githubReverseProxy');
    let githubProxyUrl = cfg.get('base.githubProxyUrl');

    if (githubProxyUrl && !githubProxyUrl.endsWith('/')) {
      githubProxyUrl += '/';
    }

    const isGithubRepo = /github\.com/.test(repoUrl);
    return isGithubRepo && githubReverseProxy && githubProxyUrl
      ? `${githubProxyUrl}${repoUrl}`
      : repoUrl;
  }

  async cloneRepo() {
    let repositoryUrl = this._getProxyUrl(this.repository);

    let res = await this.execSingle(
      'cloneRepo',
      `git clone --single-branch --depth=1 "${repositoryUrl}" "${this.directory}"`
    );

    let status = res.error 
      ? (res.stderr?.includes('[因需要账号验证已自动跳过]') ? GitTools.STATUS.AUTH_ERROR : GitTools.STATUS.ERROR) 
      : GitTools.STATUS.OK;

    // 失败自动切换备用链接 (Fallback)
    if (status === GitTools.STATUS.AUTH_ERROR && this.options.fallbackUrl && this.repository !== this.options.fallbackUrl) {
      if (typeof logger !== 'undefined') logger.warn(`[Guoba] "${this.name}" 仓库克隆受限，正在尝试切换至备用链接 (GitHub)...`);
      
      this.repository = this.options.fallbackUrl;
      repositoryUrl = this._getProxyUrl(this.repository);

      // 清理可能克隆到一半的残留空文件夹
      const rmSync = fs.rmSync || fs.rmdirSync;
      if (fs.existsSync(this.directory)) {
        try { rmSync(this.directory, { recursive: true, force: true }) } catch(e) {}
      }

      res = await this.execSingle(
        'cloneRepo_fallback',
        `git clone --single-branch --depth=1 "${repositoryUrl}" "${this.directory}"`
      );
      
      status = res.error 
        ? (res.stderr?.includes('[因需要账号验证已自动跳过]') ? GitTools.STATUS.AUTH_ERROR : GitTools.STATUS.ERROR) 
        : GitTools.STATUS.OK;
    }

    return { ...res, status };
  }

  /**
   * 重置仓库，一般用于强制更新
   */
  async reset() {
    const res = await this.execSingle('reset', `git -C "${this.directory}" reset --hard`)
    if (res.error) {
      return {
        ...res,
        status: GitTools.STATUS.ERROR,
      }
    }
    return {
      ...res,
      status: GitTools.STATUS.OK,
    }
  }

  async pull() {
    let res = await this.execSingle('pull', `git -C "${this.directory}" pull`)
    let status = GitTools.PULL_STATUS.UP_TO_DATE;

    if (res.error) {
      status = res.stderr?.includes('[因需要账号验证已自动跳过]') ? GitTools.STATUS.AUTH_ERROR : GitTools.STATUS.ERROR;
    }

    // 失败自动切换备用链接 (Fallback)
    if (status === GitTools.STATUS.AUTH_ERROR && this.options.fallbackUrl && this.repository !== this.options.fallbackUrl) {
      if (typeof logger !== 'undefined') logger.warn(`[Guoba] "${this.name}" 仓库更新受限，正在尝试切换至备用链接 (GitHub)...`);
      
      this.repository = this.options.fallbackUrl;
      
      // 修改本地仓库的 remote url 指向 GitHub
      await this.exec(`git -C "${this.directory}" remote set-url origin "${this.repository}"`);
      
      res = await this.execSingle('pull_fallback', `git -C "${this.directory}" pull`);
      
      if (res.error) {
        status = res.stderr?.includes('[因需要账号验证已自动跳过]') ? GitTools.STATUS.AUTH_ERROR : GitTools.STATUS.ERROR;
      } else {
        status = GitTools.PULL_STATUS.UP_TO_DATE;
      }
    }

    return { ...res, status };
  }

  /**
   * 执行单例任务
   * @param key
   * @param cmd
   */
  async execSingle(key, cmd) {
    let cacheKey = `execSingle_${key}`
    if (this[cacheKey]) {
      // console.log(`${key} 存在任务，等待任务完成`)
      return this[cacheKey]
    }
    this[cacheKey] = this.exec(cmd)
    const res = await this[cacheKey]
    this[cacheKey] = null
    return res
  }

  /**
   * 探测当前环境是否有可用的 git（一次性缓存，避免每个仓库都探一遍）。
   *
   * 先直接跑 `git --version`；跑不起来不代表没装 —— 用启动器/框架（如 AlemonX）把
   * Yunzai 跑成子进程时，子进程常没继承到完整 PATH（连 System32 都可能缺），git 装了
   * 也调不起。这时去常见安装位置找出 git，把它的目录补进本进程 process.env.PATH，
   * 后续所有 git 命令走同一个 env 就恢复可用了。真的哪都找不到才算不可用。
   * @return {Promise<boolean>}
   */
  static isGitAvailable() {
    if (GitTools._gitAvailablePromise) return GitTools._gitAvailablePromise
    GitTools._gitAvailablePromise = (async () => {
      if (await GitTools._probeGit()) return true
      // Windows 上 PATH 被削时常连 System32 都没了，先把系统目录补回 —— 既让 where 等
      // 系统命令可用，本身也是在修复被削的 PATH。补完系统目录再探一次 git。
      if (process.platform === 'win32' && GitTools._ensureSystemDirsInPath()) {
        if (await GitTools._probeGit()) return true
      }
      // 还没有：找出 git 目录补进 PATH 再探一次
      const gitDir = await GitTools._findGitDir()
      if (gitDir) {
        GitTools._prependPath(gitDir)
        if (typeof logger !== 'undefined') {
          logger.mark(`[Guoba] git 不在进程 PATH 中，已自动补入其安装目录：${gitDir}`)
        }
        if (await GitTools._probeGit()) return true
      }
      return false
    })()
    return GitTools._gitAvailablePromise
  }

  /** 把一个目录前插进本进程 process.env.PATH（已存在则不重复插） */
  static _prependPath(dir) {
    const sep = process.platform === 'win32' ? ';' : ':'
    const cur = process.env.PATH || ''
    const has = cur.split(sep).some(p => p && path.resolve(p) === path.resolve(dir))
    if (!has) process.env.PATH = `${dir}${sep}${cur}`
  }

  /**
   * Windows 专用：把系统目录（System32 等）补回 process.env.PATH。
   * PATH 被启动器/框架削光时连 System32 都没了，chcp/where/netstat 这些系统自带命令
   * 全调不起；补回来后 where 才能用，也顺带让别处依赖系统命令的逻辑不崩。
   * @return {boolean} 是否补入了新目录
   */
  static _ensureSystemDirsInPath() {
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    const sysDirs = [
      path.join(sysRoot, 'System32'),
      sysRoot,
      path.join(sysRoot, 'System32', 'Wbem'),
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ]
    let added = false
    for (const dir of sysDirs) {
      try {
        if (!fs.existsSync(dir)) continue
        const before = process.env.PATH
        GitTools._prependPath(dir)
        if (process.env.PATH !== before) added = true
      } catch {}
    }
    return added
  }

  /** 跑一次 `git --version` 判断当前 PATH 下 git 是否可用 */
  static _probeGit() {
    return new Promise((resolve) => {
      exec('git --version', {windowsHide: true}, (error) => resolve(!error))
    })
  }

  /**
   * 找 git 所在目录（返回含 git 可执行文件的那个目录，供拼进 PATH）。
   * 先扫常见安装位置（同步、无副作用、覆盖标准安装）；没中再用 where/which 定位 ——
   * 这一步能找到装在任意自定义盘/目录的 git（前提是系统目录已补回、where 可用）。
   * @return {Promise<string|null>}
   */
  static async _findGitDir() {
    const isWin = process.platform === 'win32'
    const exe = isWin ? 'git.exe' : 'git'
    const candidateDirs = []
    if (isWin) {
      const envDirs = [
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.ProgramW6432,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      ].filter(Boolean)
      for (const base of envDirs) {
        candidateDirs.push(path.join(base, 'Git', 'cmd'))
        candidateDirs.push(path.join(base, 'Git', 'bin'))
      }
      // 环境变量也可能没继承到，兜底写几个最常见的绝对路径
      for (const base of ['C:\\Program Files', 'C:\\Program Files (x86)']) {
        candidateDirs.push(path.join(base, 'Git', 'cmd'))
        candidateDirs.push(path.join(base, 'Git', 'bin'))
      }
      // scoop / winget 用户级安装
      const home = os.homedir()
      if (home) {
        candidateDirs.push(path.join(home, 'scoop', 'apps', 'git', 'current', 'cmd'))
        candidateDirs.push(path.join(home, 'scoop', 'shims'))
      }
    } else {
      candidateDirs.push('/usr/bin', '/usr/local/bin', '/bin', '/opt/homebrew/bin')
    }
    for (const dir of candidateDirs) {
      try {
        if (fs.existsSync(path.join(dir, exe))) return dir
      } catch {}
    }
    // 常见位置都没中：用 where/which 定位任意安装位置的 git
    const located = await GitTools._whichGit()
    if (located) return path.dirname(located)
    return null
  }

  /**
   * 用系统命令定位 git 可执行文件的绝对路径（Windows: where，其余: command -v）。
   * 取第一行结果；换行按 /\r?\n/ 切，兼容两端。
   * @return {Promise<string|null>}
   */
  static _whichGit() {
    const cmd = process.platform === 'win32' ? 'where git' : 'command -v git'
    return new Promise((resolve) => {
      exec(cmd, {windowsHide: true}, (error, stdout) => {
        if (error || !stdout) return resolve(null)
        const first = String(stdout).split(/\r?\n/).map(s => s.trim()).find(Boolean)
        resolve(first || null)
      })
    })
  }

  exec(cmd) {
    const beginTime = Date.now()
    return new Promise((resolve) => {
      exec(`${cmd}`, {
        windowsHide: true,
        // 添加 env 环境变量，强制 Git 不要弹出账号密码输入提示
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // 禁用终端提示
          GIT_ASKPASS: 'echo'       // 即使尝试弹窗也会直接返回空并报错
        }
      }, (error, stdout, stderr) => {
        const timeMs = Date.now() - beginTime
        
        // 检测 stderr 中是否包含因缺少账号密码而导致的报错
        if (stderr && (stderr.includes('could not read Username') || stderr.includes('Authentication failed') || stderr.includes('terminal prompts disabled'))) {
          const warnStr = `[Guoba][GitTools] 仓库 "${this.name}" 访问受限！[目标地址]：${this.repository} [原因]：该仓库需要账号密码验证（可能是私有仓库或链接已失效）。系统将尝试干预处理。`;
          if (typeof logger !== 'undefined') {
            logger.warn(warnStr);
          } else {
            console.error(warnStr);
          }
          // 在 stderr 前面加上明确的标识，方便上层方法的 catch / log 也能清楚原因
          stderr = `[因需要账号验证已自动跳过] ${stderr}`;
        }

        resolve({error, stdout, stderr, timeMs});
      });
    });
  }

}

