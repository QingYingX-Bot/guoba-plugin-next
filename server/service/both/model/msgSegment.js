import path from 'path'
import crypto from 'crypto'

/**
 * 消息段规范化。
 *
 * 沙盒与消息记录都要把「Yunzai 那边的消息」变成前端能渲染的段数组，两边共用一份，
 * 输出结构才严格一致，前端 `components/msg/MsgSegment.vue` 一个组件就能同时伺候两页。
 *
 * 两边的差异只有这几个开关：
 * - `rich`：目标平台是否渲染 button / markdown 段（沙盒模拟普通平台时为 false，会标 ignored）
 * - `download`：非 http 的资源（本地路径、Buffer、base64）要不要读进内存资源表。
 *   沙盒截的是插件刚生成的图，只有读盘才看得到；消息记录拿的是 QQ 服务端记录，
 *   段里本来就带直链，读盘既没必要又白占内存，所以传 false。
 * - `selfId` / `sep`：QQ 官方机器人的 id 是 `${selfId}:${openid}` 复合形式，从正文里
 *   扒出来的 openid 得拼回这个形式，上层按它查昵称才对得上（见 ChatService 的 #resolveNames）
 * - `dropFace`：QQ 官方机器人的 face 段是客户端表情 / 表情包的内联标记，网页上还原不了
 *   （表情包的图另有 image 段），留着只会显示成 `[表情0]`
 * - `botMarkdown`：这段正文要不要直接当 markdown 渲染。QQBot 那边机器人发的正文
 *   光靠内容猜会漏掉「只有加粗 / 标题、没有链接」的那种
 */

/** 资源表最多留多少项 */
const MAX_ASSETS = 60
/** 单个资源的大小上限，超了不留，只报个尺寸 */
export const MAX_ASSET_SIZE = 20 * 1024 * 1024
/** 资源存活时长，页面早就关了就没必要留着占内存 */
const ASSET_TTL = 30 * 60 * 1000
/** 转发消息最多展开几层，防御自引用的 node */
const MAX_FORWARD_DEPTH = 3
/** 兜底展示的原始 JSON 最多留多少字符 */
const MAX_DUMP_LEN = 2000

export const isHttp = (v) => typeof v === 'string' && /^https?:\/\//.test(v)

/**
 * dataURL / 裸 base64 统一成 Yunzai 认的 `base64://` 形式。
 *
 * 各适配器与 puppeteer 都按这个约定读图（见 lib/util.js 的 fileType），
 * 无论是沙盒里塞给插件的 e.img，还是消息记录里真发出去的图，都走这一份。
 */
export function toBase64File(input) {
  if (typeof input !== 'string' || !input) return null
  if (input.startsWith('base64://')) return input
  const m = input.match(/^data:[^;]*;base64,(.+)$/s)
  if (m) return `base64://${m[1]}`
  if (/^[A-Za-z0-9+/=\s]+$/.test(input)) return `base64://${input.replace(/\s/g, '')}`
  return null
}

/**
 * OneBot 原生段 `{type, data: {...}}` 拍成 `{...data, type}`。
 *
 * 适配器收消息时会用 `parseMsg` 做这一步（OneBotv11.js 的 parseMsg），所以正常路径上
 * 拿到的段已经是平铺的。只有 `get_forward_msg` 返回里那些放在 `content` 字段下的子消息
 * 漏掉了这一步，取合并转发时补一下，否则 `{type:'text', data:{text}}` 会被读成空文本。
 *
 * 只展开纯对象形式的 data —— Yunzai 自己的 node / button / markdown 段也用 data，
 * 但那几个是数组或另有语义，不能一起拍。
 */
export function flattenOneBot(msg) {
  const list = Array.isArray(msg) ? msg : [msg]
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item
    const data = item.data
    if (data && typeof data === 'object' && !Array.isArray(data)) return {...data, type: item.type}
    return item
  })
}

/**
 * 内存资源表：图片、语音、文件的字节留在这儿，段里只给 id，
 * 前端再按需拉取 —— 避免把几百 KB 的 base64 塞进 JSON。
 *
 * id 用内容哈希，而不是自增序号。沙盒聊天会进 localStorage，资源 URL 又有
 * `Cache-Control: max-age=1800`：若重启后仍发 a1、a2，浏览器会把上一轮别的
 * 角色面板图当成当前这条（典型表现：发火神面板却看到木偶 / 芙宁娜）。
 * 同内容同 id 还能让重复截图命中缓存，这是正确的。
 */
export class AssetStore {
  /** assetId -> {buffer, mime, name, time} */
  #assets = new Map()

  /** 存一份资源，返回 id */
  put(buffer, mime, name) {
    this.#gc()
    const id = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20)
    const existing = this.#assets.get(id)
    if (existing) {
      // 刷新访问时间，并挪到 Map 末尾，避免被 LRU 过早丢掉
      this.#assets.delete(id)
      existing.time = Date.now()
      existing.mime = mime || existing.mime
      existing.name = name || existing.name
      this.#assets.set(id, existing)
      return id
    }
    this.#assets.set(id, {
      buffer,
      mime: mime || 'application/octet-stream',
      name: name || id,
      time: Date.now(),
    })
    // Map 保持插入序，超量时从最老的开始丢
    while (this.#assets.size > MAX_ASSETS) {
      this.#assets.delete(this.#assets.keys().next().value)
    }
    return id
  }

  /** 取一份资源，不存在返回 null，由调用方决定怎么报错 */
  get(id) {
    return this.#assets.get(String(id)) ?? null
  }

  #gc() {
    const expired = Date.now() - ASSET_TTL
    for (const [id, asset] of this.#assets) {
      if (asset.time < expired) this.#assets.delete(id)
      // 插入序即时间序，遇到没过期的就可以停了
      else break
    }
  }
}

/**
 * 把消息拍平成前端能渲染的段数组。
 *
 * 传进来的形态五花八门：字符串、Segment 对象、嵌套数组、Buffer，甚至
 * `{type:'node'}` 的转发消息，这里统一成 `{type, ...}` 的平坦列表。
 *
 * @param msg 消息内容
 * @param opts {{assets?: AssetStore, rich?: boolean, download?: boolean, selfId?: string, sep?: string, dropFace?: boolean, botMarkdown?: boolean}}
 */
export async function normalizeMsg(msg, opts = {}) {
  const ctx = {assets: null, rich: true, download: true, selfId: '', sep: ':', dropFace: false, botMarkdown: false, ...opts}
  const out = []
  await flatten(msg, out, 0, ctx)
  return out
}

async function flatten(msg, out, depth, ctx) {
  if (msg === null || msg === undefined || msg === false) return

  if (Array.isArray(msg)) {
    for (const item of msg) await flatten(item, out, depth, ctx)
    return
  }

  if (typeof msg === 'string' || typeof msg === 'number' || typeof msg === 'boolean') {
    const text = String(msg)
    if (text) out.push({type: 'text', text})
    return
  }

  // 有插件直接 reply 一个 Buffer，按图片处理（Yunzai 各适配器也是这么认的）
  if (Buffer.isBuffer(msg)) {
    out.push(await fileSeg('image', {file: msg}, ctx))
    return
  }

  if (typeof msg !== 'object') return

  const type = msg.type || (msg.file ? 'image' : '')

  switch (type) {
    case 'text':
      // 文本段里可能混着 QQ 的内联标签、@ 标记，甚至整段就是 markdown，见 pushText
      if (msg.text) pushText(msg.text, out, ctx)
      return
    case 'at': {
      /**
       * @全体成员。QQBot 的 at 段对 `all` 也拼了账号前缀（`4015656287:all`），
       * 照原样显示就是一串号；统一成 `all`，名字给「全体成员」。
       */
      const qq = String(msg.qq ?? msg.id ?? '')
      if (msg.scope === 'all' || qq.split(':').pop() === 'all') {
        out.push({type: 'at', qq: 'all', name: msg.name || msg.username || msg.text || '全体成员'})
      } else {
        out.push({type: 'at', qq, name: msg.name ?? msg.text ?? msg.username ?? ''})
      }
      return
    }
    case 'reply':
      out.push({type: 'reply', id: String(msg.id ?? msg.text ?? '')})
      return
    case 'face':
      if (!ctx.dropFace) out.push({type: 'face', id: String(msg.id ?? '')})
      return
    case 'image':
    case 'record':
    case 'video':
    case 'file':
      out.push(await fileSeg(type, msg, ctx))
      return
    case 'node':
      out.push(await nodeSeg(msg, depth, ctx))
      return
    case 'forward':
      // 真实消息里的合并转发只给一个 id，内容在 QQ 服务端，点开时再单独去取
      out.push({type: 'forward', id: String(msg.id ?? msg.res_id ?? '')})
      return
    case 'button':
      out.push(buttonSeg(msg, ctx))
      return
    case 'markdown':
      out.push(markdownSeg(msg, ctx))
      return
    case 'raw':
      // 没法在网页上还原成原样，原始数据丢给前端折叠显示
      out.push({type, raw: dump(msg)})
      return
    default:
      out.push({type: type || 'unknown', raw: dump(msg)})
  }
}

/**
 * QQ 客户端才认的内联富文本标签，网页上还原不了，去掉免得露乱码。
 */
const QQ_INLINE_TAG_RE = /<(?:faceType|attachmentType)=[^>]*>/g

/**
 * 文本段里的 @ 标记：`<@$ALL$>`（@全体成员）、`<@openid>` / `<@!openid>`（@人）。
 */
const QQ_TEXT_AT_RE = /<@!?\$?ALL\$?>|<@!?([0-9a-fA-F]{16,})>/gi

/**
 * 这段文本是不是 QQBot 的 markdown。
 */
const MD_LINK_RE = /!?\[[^\]\n]*\]\s*\(\s*(?:https?|mqqapi):\/\//

/**
 * markdown 正文落在哪个字段上各家不一样，逐个试：
 * - `content`：QQBot 适配器发出去后落库的那份（见 QQBot-Plugin/adapter/build.js，
 *   `{type:'markdown', content}`）
 * - `data` / `data.content`：`segment.markdown(...)` 
 * - `markdown.content`：官方 SDK 的原生模板形态
 */
function markdownText(msg) {
  for (const one of [msg.content, msg.data, msg.data?.content, msg.markdown?.content]) {
    if (typeof one === 'string' && one) return one
  }
  return ''
}

/**
 * markdown 段的正文清洗。
 *
 * - `\r` 归一成 `\n`：QQBot 的 markdown 用 `\r` 当行分隔符（QQBot-Plugin 的 makeMarkdownText_
 *   就是 `text.replace(/\n/g, "\r")`）。marked 内部也会做这一步，但这里先存成规范形式，
 *   原始数据页、以及后续按 `\n` 切行的代码就不用各自再处理一遍。
 * - 去掉 `<faceType=…>` / `<attachmentType=…>`：QQ 自己富文本的内联标签，正文里没有对应
 *   展示，留着会原样显示成一串尖括号。
 *   适配器那边 `attachmentType` 会换成内联媒体，这里拿不到附件上下文，只能一并删掉。
 */
function cleanMarkdown(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(QQ_INLINE_TAG_RE, '')
    // @全体成员：`<@$ALL$>` 会被 marked 当成 HTML 标签整个吃掉，先换成能显示的文本
    .replace(QQ_TEXT_AT_RE, (whole, openid) => (openid ? whole : '@全体成员'))
}

/**
 * 文本段拆成段数组。
 */
function pushText(text, out, ctx) {
  const cleaned = String(text).replace(QQ_INLINE_TAG_RE, '')
  if (!cleaned) return
  if (ctx.botMarkdown || MD_LINK_RE.test(cleaned)) {
    out.push({type: 'markdown', content: cleanMarkdown(cleaned)})
    return
  }

  let last = 0
  for (const m of cleaned.matchAll(QQ_TEXT_AT_RE)) {
    if (m.index > last) out.push({type: 'text', text: cleaned.slice(last, m.index)})
    const openid = m[1]
    out.push(openid
      ? {type: 'at', qq: ctx.selfId ? `${ctx.selfId}${ctx.sep}${openid}` : openid, name: ''}
      : {type: 'at', qq: 'all', name: '全体成员'})
    last = m.index + m[0].length
  }
  if (last < cleaned.length) out.push({type: 'text', text: cleaned.slice(last)})
}

/**
 * markdown 段。
 *
 * 原生模板（模板 id + params）的正文在 QQ 服务端，本地还原不出来，标一个 `template`
 * 让前端说清楚，别只摊一坨原始 JSON。
 */
function markdownSeg(msg, ctx) {
  const seg = {type: 'markdown'}
  const content = markdownText(msg)
  if (content) {
    seg.content = cleanMarkdown(content)
  } else {
    seg.template = true
    seg.raw = dump(msg)
  }
  if (!ctx.rich) seg.ignored = true
  return seg
}

/**
 * 按钮段。两种来源，形状不一样：
 *
 * - 插件直接发的：`segment.button(...行)`（lib/modules/oicq/index.js）把参数列表放进 `data`，
 * - QQBot 适配器发出去后落库的那份：`makeButtons` 每段就是一行，数组挂在 `buttons` 上，
 *   元素是 QQ 官方结构（`render_data.label` + `action.type/data`）。
 *
 * 认不出结构时保留原始 JSON，别让按钮悄悄消失。
 */
function buttonSeg(msg, ctx) {
  const rows = []
  // 落库形态：`buttons` 本身就是一整行，不能再当「行的数组」拆一遍，否则一行按钮会竖着排
  if (!msg.data && Array.isArray(msg.buttons)) {
    const btns = msg.buttons.map(button).filter(Boolean)
    if (btns.length) rows.push(btns)
  } else {
    for (const row of Array.isArray(msg.data) ? msg.data : [msg.data]) {
      if (!row) continue
      const btns = []
      for (const item of Array.isArray(row) ? row : [row]) {
        const btn = button(item)
        if (btn) btns.push(btn)
      }
      if (btns.length) rows.push(btns)
    }
  }
  const seg = {type: 'button', rows}
  if (!rows.length) seg.raw = dump(msg)
  if (!ctx.rich) seg.ignored = true
  return seg
}

/**
 * 单个按钮。字段各家写法不一，常见的都认一遍。
 *
 * QQ 官方结构把动作全挂在 `action` 上，`type` 决定点下去干什么：0 外链、1 直接发出去
 * （callback）、2 填进输入框等用户补参数 —— 只看 `action.data` 是分不出来的，会把
 * 「填输入框」的按钮当成「点了就发」，所以按 type 分派。其余实现把三个动作平铺在段上。
 */
function button(item) {
  if (!item || typeof item !== 'object') return null
  const btn = {text: String(item.text ?? item.label ?? item.render_data?.label ?? '')}
  const action = item.action && typeof item.action === 'object' ? item.action : null

  if (action) {
    const data = action.data == null ? '' : String(action.data)
    const type = Number(action.type)
    if (type === 0) btn.link = data
    else if (type === 2) btn.input = data
    else btn.callback = data
    // permission.type：1 仅管理员；0/2 是所有人或指定用户，后者有名单才算受限
    const perm = action.permission
    if (perm?.type === 1 || perm?.specify_user_ids?.length) btn.limited = true
  } else {
    // 平铺形态：动作值可能在 callback / input / link 上，也可能塞在 data 里
    const act = item.data
    const callback = item.callback ?? (isHttp(act) ? null : act)
    const link = item.link ?? item.url ?? (isHttp(act) ? act : null)
    if (callback != null && typeof callback !== 'object') btn.callback = String(callback)
    if (item.input != null) btn.input = String(item.input)
    if (link != null) btn.link = String(link)
    if (item.permission) btn.limited = true
  }
  return btn.text || btn.callback || btn.input || btn.link ? btn : null
}

/**
 * 图片 / 语音 / 视频 / 文件段。
 *
 * http 直链直接把 url 给前端，让浏览器自己拉，既省一次服务端下载也省内存；
 * base64、本地路径、Buffer 才走 `Bot.fileType` 取字节存进资源表。
 */
async function fileSeg(type, msg, ctx) {
  const seg = {type, name: typeof msg.name === 'string' ? msg.name : ''}
  /**
   * 图片的 sub_type：1 表示表情包。
   *
   * 面板里发出去的表情也是图片段，只是带了 sub_type=1；不带下来的话回显会变成
   * 一张能点开放大的大图 —— QQ 客户端里它是小表情。
   * ICQQ 那边这个标记叫 asface（parser 只给图片段设这个），一并认。
   */
  const subType = msg.sub_type ?? msg.subType ?? msg.data?.sub_type
  if (subType != null && Number.isFinite(Number(subType))) seg.subType = Number(subType)
  else if (msg.asface) seg.subType = 1
  /**
   * url 优先。真实消息段里 `file` 是 `xxx.image` 这类平台内部名，`Bot.fileType` 读不了，
   * 能看的只有 url；插件发出来的段则通常只有 file，两种都覆盖到。
   */
  const src = isHttp(msg.url) ? msg.url : (msg.file ?? msg.url ?? msg.data)

  if (isHttp(src)) {
    seg.url = src
    if (msg.file_size) seg.size = Number(msg.file_size) || undefined
    if (!seg.name && typeof msg.file === 'string' && !isHttp(msg.file)) seg.name = msg.file
    return seg
  }

  if (!ctx.download) {
    // 消息记录只认服务端给的直链，本地路径与内部文件名不去读盘，如实报一句
    seg.name = seg.name || (typeof src === 'string' ? path.basename(src) : '')
    if (msg.file_size) seg.size = Number(msg.file_size) || undefined
    seg.error = '无可用链接'
    return seg
  }

  let file
  try {
    file = await Bot.fileType({file: src, name: msg.name})
  } catch (err) {
    seg.error = String(err?.message ?? err)
    return seg
  }

  if (!Buffer.isBuffer(file?.buffer)) {
    // fileType 内部把异常吞了，取不到字节时它会返回一个只有 name/url 的壳
    seg.error = '读取失败'
    seg.name ||= file?.name ?? ''
    return seg
  }

  seg.name = seg.name || file.name || ''
  seg.size = file.buffer.length
  const mime = file.type?.mime || (type === 'image' ? 'image/png' : 'application/octet-stream')
  if (file.buffer.length > MAX_ASSET_SIZE) {
    // 超大的不往内存里塞，只把尺寸报给前端
    seg.tooLarge = true
    return seg
  }
  if (!ctx.assets) {
    seg.error = '资源未保留'
    return seg
  }
  seg.assetId = ctx.assets.put(file.buffer, mime, seg.name)
  seg.mime = mime
  return seg
}

/** 转发消息。data 是 `{nickname, user_id, message}` 的数组，逐条递归展开 */
async function nodeSeg(msg, depth, ctx) {
  const seg = {type: 'node', nodes: []}
  if (depth >= MAX_FORWARD_DEPTH) {
    // 自引用的 node 会无限套下去，到这层就不再展开
    seg.truncated = true
    return seg
  }
  const list = Array.isArray(msg.data) ? msg.data : [msg.data]
  for (const node of list) {
    if (!node) continue
    // 直接递归 flatten 而不是回到 normalizeMsg，深度才带得下去
    const segments = []
    await flatten(node.message ?? node.content ?? node, segments, depth + 1, ctx)
    seg.nodes.push({
      nickname: String(node.nickname ?? node.name ?? ''),
      userId: String(node.user_id ?? node.uin ?? ''),
      time: node.time ?? null,
      segments,
    })
  }
  return seg
}

/** 兜底展示：把不认识的段转成一行 JSON，太长的截掉 */
function dump(msg) {
  let text
  try {
    text = JSON.stringify(msg, (key, value) =>
      Buffer.isBuffer(value) ? `<Buffer ${value.length}>` : value)
  } catch {
    text = String(msg)
  }
  return text.length > MAX_DUMP_LEN ? `${text.slice(0, MAX_DUMP_LEN)}…` : text
}
