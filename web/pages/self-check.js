/**
 * 锅巴插件页面能力自检（demo）
 * 约定：export function mount(el) → 返回 Vue 实例（可选）
 * 注意：不得 import 裸模块，只能用 window.__GUOBA_LIB__
 */
export function mount (el) {
  const { h, ref, createApp } = window.__GUOBA_LIB__.Vue
  const { Card, Descriptions, Tag, Alert } = window.__GUOBA_LIB__.antd
  const GB = window.__GUOBA__ || {}

  const App = {
    setup () {
      const lib = window.__GUOBA_LIB__ || {}
      return () => h('div', null, [
        h(Alert, { type: 'success', showIcon: true, message: '插件页面能力正常', description: '本页由 plugins/Guoba-Plugin/web/pages/self-check.js 动态加载' }),
        h(Card, { size: 'small', title: '运行环境', style: 'margin-top:12px' }, () => h(Descriptions, { column: 2, size: 'small', bordered: true }, () => [
          h(Descriptions.Item, { label: 'Vue' }, () => (lib.Vue?.version || '未注入')),
          h(Descriptions.Item, { label: 'antd' }, () => (lib.antd?.version || '未注入')),
          h(Descriptions.Item, { label: 'webBase' }, () => (GB.webBase || '-')),
          h(Descriptions.Item, { label: 'token' }, () => (GB.token ? '已注入' : '未注入')),
        ])),
        h(Card, { size: 'small', title: '说明', style: 'margin-top:12px' }, () => [
          h('p', { style: 'margin:0 0 8px' }, '其他插件接入方式：在自己的目录建 web/pages.json + web/pages/*.js。'),
          h(Tag, { color: 'blue' }, () => 'plugins/<插件>/web/pages.json'),
          h(Tag, { color: 'blue' }, () => 'plugins/<插件>/web/pages/<id>.js'),
        ]),
      ])
    },
  }
  const app = createApp(App)
  app.mount(el)
  return app
}
