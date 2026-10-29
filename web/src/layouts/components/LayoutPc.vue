<script setup lang="ts">
/**
 * 布局 · PC 版。
 *
 * 左侧固定侧栏（可收窄到 64px）+ 右侧顶栏与内容。手机端换 LayoutMobile，
 * 那套的侧栏是覆盖式抽屉，结构完全不一样，所以不共用模板。
 */
import { computed } from 'vue'
import { Layout, LayoutSider } from 'ant-design-vue'
import SideMenu from './SideMenu.vue'
import LayoutHeader from './LayoutHeader.vue'
import AppContent from './AppContent.vue'
import { useAppStore } from '@/stores/app'
import { BUILD_TIME, GUOBA_VERSION } from '@/utils/env'

const appStore = useAppStore()
/**
 * 窄屏上用桌面版时自动收窄侧栏。
 *
 * 手机屏只有 390 宽，侧栏铺开吃掉 220，主区就剩 170 —— 表格挤成一条缝，
 * 拖都拖不动。这里在视口窄时强制图标模式，主区能多出 150 多像素。
 */
const collapsed = computed(() => appStore.viewportNarrow || appStore.sidebarCollapsed)
</script>

<template>
  <Layout class="g-layout">
    <LayoutSider
      :collapsed="collapsed"
      :collapsed-width="64"
      :width="220"
      :trigger="null"
      collapsible
      class="g-sider"
    >
      <div class="g-logo" :class="{ 'is-collapsed': collapsed }">
        <img src="/logo.png" alt="Guoba" class="g-logo-img" />
        <span v-if="!collapsed" class="g-logo-text">
          锅巴面板
          <em>v{{ GUOBA_VERSION }} · {{ BUILD_TIME }}</em>
        </span>
      </div>

      <div class="g-sider-scroll">
        <SideMenu :collapsed="collapsed" />
      </div>
    </LayoutSider>

    <Layout class="g-main">
      <LayoutHeader />
      <AppContent />
    </Layout>
  </Layout>
</template>

<style scoped>
.g-layout {
  height: 100vh;
  /* 移动端浏览器地址栏会吃掉高度，有 dvh 就用 dvh（强制桌面版时也会走到） */
  height: 100dvh;
  overflow: hidden;
}

.g-sider {
  border-inline-end: 1px solid var(--g-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--g-bg-sider);
}

.g-sider :deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.g-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--g-border);
  overflow: hidden;
}

.g-logo.is-collapsed {
  justify-content: center;
  padding: 0;
}

.g-logo-img {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.g-logo-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text);
  white-space: nowrap;
}

.g-logo-text em {
  display: block;
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  color: var(--g-text-dim);
  line-height: 1.2;
}

.g-sider-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.g-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
