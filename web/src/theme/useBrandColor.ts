import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { BRAND, BRAND_LIGHT } from '@/theme'

/**
 * 给「只能吃颜色字符串」的地方用的品牌色：ECharts 的 canvas、内联 style、
 * antd 的 `<Tag color="...">`。这些位置写不了 `var(--g-brand)`，
 * 但颜色又必须跟主题走 —— 浅色主题下暖金对比度只有 2.2:1（见 theme/index.ts）。
 *
 * CSS 能写变量的地方一律用 `var(--g-brand)`，别绕到这里来。
 */
export function useBrandColor() {
  const appStore = useAppStore()
  const brand = computed(() => (appStore.isDark ? BRAND : BRAND_LIGHT))
  return { brand }
}
