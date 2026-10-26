/**
 * 顶栏的层级标题。
 *
 * PC 端用它画面包屑（首页 > 插件管理 > xxx），手机端只取最后一级当页面名 ——
 * 两套顶栏都要，抽出来免得各写一遍再漂移。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { MenuItem as GMenuItem } from '@/types'

export function useBreadcrumbs() {
  const auth = useAuthStore()
  const route = useRoute()

  /** 用后端菜单树推导面包屑；找不到时退化为当前路由 meta.title */
  const breadcrumbs = computed<string[]>(() => {
    const path = route.path

    function walk(items: GMenuItem[], trail: string[]): string[] | null {
      for (const item of items) {
        const title = item.meta?.title ?? item.name
        const nextTrail = [...trail, title]
        if (item.path === path) return nextTrail
        if (item.children?.length) {
          const found = walk(item.children, nextTrail)
          if (found) return found
        }
      }
      return null
    }

    const found = walk(auth.menus, [])
    if (found) return dedupe(found)

    const title = route.meta?.title as string | undefined
    return title ? [title] : []
  })

  const pageTitle = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1] ?? '')

  /** 二级及更深的页面（插件详情这类），手机顶栏要给它一个返回 */
  const isSubPage = computed(() => breadcrumbs.value.length > 1)

  return { breadcrumbs, pageTitle, isSubPage }
}

/**
 * 去掉相邻重复的层级。
 *
 * 菜单里的「插件管理」下面又挂了一个叫「插件管理」的子项，面包屑照原样拼出来
 * 就是「插件管理 / 插件管理」，看着像坏了。
 */
function dedupe(trail: string[]) {
  return trail.filter((title, i) => i === 0 || title !== trail[i - 1])
}
