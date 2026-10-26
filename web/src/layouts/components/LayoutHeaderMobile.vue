<script setup lang="ts">
/**
 * 顶栏 · 手机版。
 *
 * 只留三样：打开抽屉的按钮、当前页名、账号区。面包屑在手机上又长又难点，
 * 交给各页面自己的返回/层级入口（文件管理页就有自己的上一级）。
 */
import { useRouter } from 'vue-router'
import { Button, LayoutHeader as AHeader } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import HeaderActions from './HeaderActions.vue'
import { useBreadcrumbs } from './useBreadcrumbs'

const appStore = useAppStore()
const router = useRouter()
const { pageTitle, isSubPage } = useBreadcrumbs()

/**
 * 返回上一页。直接打开深层链接时没有可退的历史，
 * 这时退回首页，总比按钮点了没反应强。
 */
function goBack() {
  const back = (router.options.history.state as { back?: string | null })?.back
  if (back) router.back()
  else void router.push('/home')
}
</script>

<template>
  <AHeader class="g-header g-header-mobile">
    <div class="g-header-left">
      <!-- 二级页面先给返回，再给菜单；一级页面只留菜单 -->
      <Button v-if="isSubPage" type="text" class="g-icon-btn" @click="goBack">
        <GIcon icon="ant-design:left-outlined" :size="18" />
      </Button>
      <Button type="text" class="g-icon-btn" @click="appStore.toggleSidebar()">
        <GIcon icon="ant-design:menu-unfold-outlined" :size="18" />
      </Button>
      <span class="g-header-title">{{ pageTitle }}</span>
    </div>

    <HeaderActions />
  </AHeader>
</template>

<style scoped>
.g-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 50px;
  padding: 0 6px 0 2px;
  border-bottom: 1px solid var(--g-border);
  background: var(--g-bg-header);
}

.g-header-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.g-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  padding: 0;
  color: var(--g-text-sub);
}

.g-header-title {
  overflow: hidden;
  color: var(--g-text);
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
