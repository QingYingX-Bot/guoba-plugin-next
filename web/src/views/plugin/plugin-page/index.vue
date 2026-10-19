<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Alert, Spin } from 'ant-design-vue'
import { get } from '@/api/request'
import { API_BASE, REAL_MOUNT_PREFIX, TOKEN_KEY } from '@/utils/env'
import { useAuthStore } from '@/stores/auth'

/**
 * 插件页面容器。
 *
 * 路由 `/plugin/@/:name/page/:pageId` 进入，按清单找到入口文件，
 * 通过运行时 `import()` 加载插件自己的页面模块，再调用它的 `mount(el)`。
 * 页面模块不得 import 裸模块（vue / ant-design-vue），只能用 `window.__GUOBA_LIB__`。
 */

const route = useRoute()
const box = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
const app = shallowRef<any>(null)

interface PluginPage {
  id: string
  title: string
  icon?: string
  component: string
}

function unmount () {
  try {
    const inst = app.value
    if (!inst) return
    if (typeof inst.unmount === 'function') inst.unmount()
  } catch (e) {
    console.warn('[plugin-page] unmount failed', e)
  } finally {
    app.value = null
    if (box.value) box.value.innerHTML = ''
  }
}

async function findEntry (plugin: string, pageId: string): Promise<PluginPage | null> {
  const data: any = await get('/plugin-pages/list')
  const list = Array.isArray(data) ? data : (data?.result ?? [])
  const hit = list.find((item: any) => String(item.plugin).toLowerCase() === plugin.toLowerCase())
  if (!hit) return null
  return (hit.pages || []).find((p: any) => String(p.id) === pageId) || null
}

async function load () {
  loading.value = true
  error.value = ''
  unmount()
  try {
    const plugin = String(route.params.name ?? '')
    const pageId = String(route.params.pageId ?? '')
    const page = await findEntry(plugin, pageId)
    if (!page) {
      error.value = `未找到页面：${plugin} / ${pageId}`
      return
    }
    let token = ''
    try { token = useAuthStore().token || '' } catch {}
    if (!token) token = localStorage.getItem(TOKEN_KEY) || ''
    const asset = String(page.component || '').replace(/^\//, '')
    const url = `${API_BASE}/plugin-pages/asset/${encodeURIComponent(plugin)}/${asset}${token ? `?token=${encodeURIComponent(token)}` : ''}`
    // 注入插件页面运行时上下文（与 custom-page 的 __GUOBA__ 对齐）
    ;(window as any).__GUOBA__ = {
      pageId: page.id,
      plugin,
      webBase: REAL_MOUNT_PREFIX,
      apiBase: `${API_BASE}/custom/${encodeURIComponent(plugin)}`,
      token,
      tokenKey: TOKEN_KEY,
    }
    const mod: any = await import(/* @vite-ignore */ url)
    if (typeof mod?.mount !== 'function') {
      error.value = `页面模块未导出 mount(el)：${page.component}`
      return
    }
    if (!box.value) return
    app.value = mod.mount(box.value)
  } catch (e: any) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [route.params.name, route.params.pageId], () => { load() })
onBeforeUnmount(unmount)
</script>

<template>
  <div class="plugin-page-root">
    <a-spin v-if="loading" class="plugin-page-hint" />
    <Alert v-else-if="error" type="error" show-icon :message="error" />
    <div ref="box" class="plugin-page-box" />
  </div>
</template>

<style scoped>
.plugin-page-root { min-height: 200px; }
.plugin-page-hint { display: flex; justify-content: center; padding: 48px 0; }
.plugin-page-box { min-height: 120px; }
</style>
