import { theme as antdTheme } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

/**
 * 品牌色分主题给，不共用一份。
 *
 * 深色主题用插件 icon 的暖金；浅色主题不能跟着用 —— 暖金在米白底上对比度只有 2.2:1
 * （正文要 4.5:1），而 colorPrimary 会流到链接、选中态文字、Tag 这些小字上，读起来很吃力。
 * 浅色改成同样温润但压得住的灰绿（米白底上 4.7:1）。
 * CSS 侧的对应值在 styles/index.css 的 html[data-theme] 两个块里。
 */
export const BRAND = '#d19f56'
export const BRAND_HOVER = '#e0b674'
export const BRAND_ACTIVE = '#b8873f'

export const BRAND_LIGHT = '#5f7a6b'
export const BRAND_LIGHT_HOVER = '#4e6a5c'
export const BRAND_LIGHT_ACTIVE = '#3f584c'

const sharedToken = {
  colorSuccess: '#4ca97a',
  colorWarning: '#d99b3d',
  colorError: '#d9614c',
  borderRadius: 10,
  borderRadiusLG: 14,
  fontSize: 14,
  wireframe: false,
}

/** 深色主题：偏冷的墨蓝底 + 暖金强调色 */
export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...sharedToken,
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorBgBase: '#10131a',
    colorBgContainer: '#181c25',
    colorBgElevated: '#1e2430',
    colorBgLayout: '#0d1017',
    colorBorder: '#2a3140',
    colorBorderSecondary: '#222833',
    colorText: 'rgba(255, 255, 255, 0.88)',
    colorTextSecondary: 'rgba(255, 255, 255, 0.62)',
    colorTextTertiary: 'rgba(255, 255, 255, 0.42)',
  },
  components: {
    // 注意：ant-design-vue 4.2.6 的组件级 token 沿用的是 v5-alpha 命名
    // （colorBgHeader / colorItemBg 等），不是 React antd 后来的 headerBg / itemBg
    Layout: {
      colorBgBody: '#0d1017',
      colorBgHeader: '#12161f',
      colorBgTrigger: '#1e2430',
    },
    Menu: {
      colorItemBg: 'transparent',
      colorSubItemBg: 'transparent',
      colorItemBgSelected: 'rgba(209, 159, 86, 0.16)',
      colorItemTextSelected: BRAND_HOVER,
      colorItemBgHover: 'rgba(255, 255, 255, 0.06)',
      radiusItem: 8,
      itemMarginInline: 8,
    },
    Card: {
      colorBgContainer: '#181c25',
    },
  },
}

/** 浅色主题：暖米白底 + 灰绿强调色，边框细、饱和度低 */
export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorPrimary: BRAND_LIGHT,
    colorInfo: BRAND_LIGHT,
    // 底色带一点暖，纯白配灰绿会显得发青
    colorBgBase: '#fbfaf6',
    colorBgContainer: '#fbfaf6',
    colorBgElevated: '#fdfcf9',
    colorBgLayout: '#f5f3ec',
    colorBorder: '#e3ded1',
    colorBorderSecondary: '#eeeae0',
    // antd 默认的中性色是冷灰，在暖底上会偏青，这里换成同色系的暖灰
    colorText: '#35322c',
    colorTextSecondary: '#6b665c',
    colorTextTertiary: '#9a948a',
    colorError: '#c0503c',
  },
  components: {
    Layout: {
      colorBgBody: '#f5f3ec',
      colorBgHeader: '#fbfaf6',
      colorBgTrigger: '#f0ede4',
    },
    Menu: {
      colorItemBg: 'transparent',
      colorSubItemBg: 'transparent',
      colorItemBgSelected: 'rgba(95, 122, 107, 0.13)',
      colorItemTextSelected: BRAND_LIGHT_ACTIVE,
      colorItemBgHover: 'rgba(53, 50, 44, 0.05)',
      radiusItem: 8,
      itemMarginInline: 8,
    },
    Card: {
      colorBgContainer: '#fbfaf6',
    },
  },
}

export function useThemeConfig(isDark: boolean): ThemeConfig {
  return isDark ? darkTheme : lightTheme
}
