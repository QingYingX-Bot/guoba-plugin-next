/**
 * 浮层挂载点。
 *
 * antd 默认把 Select / DatePicker / Tooltip 这类浮层挂到 `document.body`。
 * 但本面板的滚动发生在 `.g-content`（见 layouts/BasicLayout.vue：`.g-layout` 是
 * 100vh + overflow:hidden，body 自己不滚），挂在 body 上的浮层按文档坐标定位，
 * 滚 `.g-content` 时它不跟着动 —— 看起来就是「钉在屏幕上」，和触发的输入框脱开。
 *
 * `.g-content` 本身就是 `position: relative`，浮层挂进去就能跟着内容一起滚。
 * 挂在最外层滚动容器（而不是 `node.parentNode`）还能顺带绕开卡片、表格、
 * 代码块这些中间层 `overflow: hidden/auto` 的裁切。
 *
 * 用法：`<ConfigProvider :get-popup-container="getPopupContainer">`
 */
export function getPopupContainer(node?: HTMLElement | null): HTMLElement {
  const scroller = node?.closest?.('.g-content')
  return (scroller as HTMLElement) || document.body
}
