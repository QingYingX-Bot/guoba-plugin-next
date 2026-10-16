/**
 * markdown 图片的尺寸。
 */

/** 气泡里图片的宽度上限，与 .g-seg-md img 的 max-width 保持一致 */
export const MD_IMG_MAX_W = 340

/** `#36px #36px`（宽 高） */
const SIZE_BOTH_RE = /#?(\d+)px\s*#(\d+)px/
/** 只写一个数时是高度 */
const SIZE_ONE_RE = /#(\d+)px/
/**
 * QQ 有时把尺寸拼在地址尾巴上（`…jpg#36px`）。这种得摘掉：
 * 那个 fragment 会被当成参数发给图床，图就取不回来了。
 */
const URL_SIZE_RE = /[?#]\d+px.*$/
/** 一个完整的 img 标签 */
const IMG_TAG_RE = /<img\b[^>]*>/gi
/** 属性值一律是双引号 —— marked 生成的标签就长这样 */
const ALT_ATTR_RE = /\salt="([^"]*)"/
const SRC_ATTR_RE = /\ssrc="([^"]*)"/

interface MdImageSize {
  /** 0 表示只声明了高度 */
  width: number
  height: number
  /** 命中的那段原文，要按它从 alt 里删掉 */
  text: string
}

/** 从说明文字里认出尺寸，认不出返回 null */
function sizeOf(alt: string): MdImageSize | null {
  const both = SIZE_BOTH_RE.exec(alt)
  if (both) return {width: Number(both[1]), height: Number(both[2]), text: both[0]}
  const one = SIZE_ONE_RE.exec(alt)
  if (one) return {width: 0, height: Number(one[1]), text: one[0]}
  return null
}

/** 按声明的尺寸拼行内样式 */
function styleOf(size: MdImageSize, maxWidth: number) {
  if (!size.width) return `max-height:${size.height}px`
  let {width, height} = size
  if (width > maxWidth) {
    // 高度等比缩，不然按声明的高度渲染会被 max-width 压成横向变形
    height = height ? Math.round((height * maxWidth) / width) : 0
    width = maxWidth
  }
  return `width:${width}px${height ? `;height:${height}px` : ''}`
}

/**
 * 把一段已 sanitize 的 HTML 里所有 img 的声明尺寸落成行内样式。
 *
 * @param html     已经过 DOMPurify 的 HTML
 * @param maxWidth 气泡内的宽度上限
 */
export function applyMdImageSize(html: string, maxWidth = MD_IMG_MAX_W): string {
  if (!html || !html.includes('<img')) return html
  return html.replace(IMG_TAG_RE, (tag) => {
    const altMatch = ALT_ATTR_RE.exec(tag)
    const srcMatch = SRC_ATTR_RE.exec(tag)
    const size = altMatch ? sizeOf(altMatch[1]) : null
    const cleanSrc = srcMatch ? srcMatch[1].replace(URL_SIZE_RE, '') : ''

    // 没尺寸、地址也不用清 —— 一个字都不动
    if (!size && (!srcMatch || cleanSrc === srcMatch[1])) return tag

    // 去掉结尾的 `>` / ` />`，属性改完再统一补回去
    let body = tag.replace(/\s*\/?>$/, '')
    if (altMatch && size) {
      // 尺寸不该再显示成图片说明
      const alt = altMatch[1].replace(size.text, '').replace(/\s+/g, ' ').trim()
      body = body.replace(altMatch[0], ` alt="${alt}"`)
    }
    if (srcMatch && cleanSrc !== srcMatch[1]) {
      body = body.replace(srcMatch[0], ` src="${cleanSrc}"`)
    }
    if (size) body += ` style="${styleOf(size, maxWidth)}"`
    return `${body}>`
  })
}
