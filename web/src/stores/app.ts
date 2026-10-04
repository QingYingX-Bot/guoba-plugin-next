import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { API_BASE, INJECTED_THEME, THEME_STORAGE_KEY } from '@/utils/env'
import {
  DEFAULT_THEME,
  brandVars,
  normalizeTheme,
  resolvePrimary,
  type ThemeMode,
  type ThemeSettings,
} from '@/theme/config'
import { apiSaveTheme } from '@/api'
import { useAuthStore } from '@/stores/auth'

export type { ThemeMode }

const SIDEBAR_KEY = 'guoba:sidebar-collapsed'

/** 窄屏断点：侧边栏改为覆盖式抽屉，不再挤占内容宽度 */
const MOBILE_QUERY = '(max-width: 768px)'

/**
 * 首屏初始值
 */
function initialSettings(): ThemeSettings {
  const injected = INJECTED_THEME ? normalizeTheme(INJECTED_THEME) : null
  const cached = localStorage.getItem(THEME_STORAGE_KEY)
  const cachedMode: ThemeMode | null = cached === 'light' || cached === 'dark' ? cached : null
  const base = injected ?? DEFAULT_THEME
  return normalizeTheme({ ...base, mode: cachedMode ?? base.mode })
}

function signature(settings: ThemeSettings) {
  return JSON.stringify([
    settings.themeId,
    settings.primaryColor,
    settings.borderRadius,
    settings.fontSize,
    settings.backgrounds,
  ])
}

export const useAppStore = defineStore('app', () => {
  const auth = useAuthStore()

  const saved = ref<ThemeSettings>(initialSettings())
  const live = ref<ThemeSettings>(normalizeTheme(saved.value))

  const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_KEY) === '1')

  const isMobile = ref(window.matchMedia(MOBILE_QUERY).matches)
  /** 仅窄屏使用：抽屉是否展开 */
  const drawerOpen = ref(false)

  const mode = computed(() => live.value.mode)
  const isDark = computed(() => live.value.mode === 'dark')
  const effectivePrimary = computed(() => resolvePrimary(live.value.mode, live.value.primaryColor))
  const isDirty = computed(() => signature(live.value) !== signature(saved.value))

  /**
   * 当前模式的背景图地址
   */
  const bgImageUrl = computed(() => {
    if (live.value.themeId !== 'glass') return ''
    const name = live.value.backgrounds[live.value.mode]
    if (!name) return ''
    const q = new URLSearchParams({ name, token: auth.liteToken || auth.token })
    return `${API_BASE}/theme/background/image?${q.toString()}`
  })

  function applyTheme() {
    const settings = live.value
    const root = document.documentElement
    root.setAttribute('data-theme', settings.mode)
    root.setAttribute('data-theme-id', settings.themeId)
    root.style.colorScheme = settings.mode
    const url = bgImageUrl.value
    root.dataset.hasBg = url ? '1' : '0'
    const vars: Record<string, string> = {
      ...brandVars(settings.mode, settings.primaryColor),
      '--g-radius': `${settings.borderRadius}px`,
      '--g-radius-lg': `${settings.borderRadius + 4}px`,
      '--g-font-size': `${settings.fontSize}px`,
      '--g-bg-image': url ? `url("${url}")` : 'none',
    }
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value)
    }
  }

  /**
   * 深浅模式切换
   */
  function setMode(next: ThemeMode) {
    live.value = { ...live.value, mode: next }
    saved.value = { ...saved.value, mode: next }
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  function toggleTheme() {
    setMode(live.value.mode === 'dark' ? 'light' : 'dark')
  }

  function previewTheme(next: ThemeSettings) {
    live.value = normalizeTheme({ ...next, mode: live.value.mode })
  }

  /** 撤回未保存的预览 */
  function revert() {
    previewTheme(saved.value)
  }

  function applySaved(next: Partial<ThemeSettings>) {
    const settings = normalizeTheme({ ...next, mode: live.value.mode })
    saved.value = settings
    live.value = normalizeTheme(settings)
    localStorage.setItem(THEME_STORAGE_KEY, settings.mode)
  }

  async function saveCurrent(next: ThemeSettings) {
    const settings = normalizeTheme({ ...next, mode: live.value.mode })
    const result = await apiSaveTheme({
      themeId: settings.themeId,
      primaryColor: settings.primaryColor,
      borderRadius: settings.borderRadius,
      fontSize: settings.fontSize,
      backgrounds: settings.backgrounds,
    })
    applySaved(result)
    return saved.value
  }

  /** 窄屏切抽屉，宽屏切收窄 —— 同一个按钮两种语义 */
  function toggleSidebar() {
    if (isMobile.value) {
      drawerOpen.value = !drawerOpen.value
    } else {
      sidebarCollapsed.value = !sidebarCollapsed.value
    }
  }

  function closeDrawer() {
    drawerOpen.value = false
  }

  /** 监听断点变化：进窄屏关抽屉，回宽屏恢复本地保存的收窄状态 */
  function setupResponsive() {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryList | MediaQueryListEvent) => {
      isMobile.value = e.matches
      drawerOpen.value = false
    }
    mql.addEventListener('change', onChange)
    onChange(mql)
  }

  watch([live, () => auth.liteToken], applyTheme, { deep: true, immediate: true })

  watch(sidebarCollapsed, (val) => {
    localStorage.setItem(SIDEBAR_KEY, val ? '1' : '0')
  })

  return {
    saved,
    live,
    mode,
    isDark,
    effectivePrimary,
    isDirty,
    sidebarCollapsed,
    isMobile,
    drawerOpen,
    toggleTheme,
    toggleSidebar,
    closeDrawer,
    setupResponsive,
    previewTheme,
    revert,
    applySaved,
    saveCurrent,
  }
})
