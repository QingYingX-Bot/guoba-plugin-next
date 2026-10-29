<script setup lang="ts">
/**
 * 布局 · 手机版。
 *
 * 侧栏不再占内容宽度，改成覆盖式抽屉：点顶栏按钮拉开，点遮罩或右上关闭按钮收起，
 * 跳到新页面也自动收起。内容区交给 AppContent，跟 PC 共用。
 */
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { Layout, LayoutSider } from 'ant-design-vue'
import SideMenu from './SideMenu.vue'
import LayoutHeaderMobile from './LayoutHeaderMobile.vue'
import AppContent from './AppContent.vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import { BUILD_TIME, GUOBA_VERSION } from '@/utils/env'

const appStore = useAppStore()
const route = useRoute()

// 抽屉里点菜单跳转后顺手收起
watch(
  () => route.fullPath,
  () => appStore.closeDrawer(),
)
</script>

<template>
  <Layout class="g-layout is-mobile">
    <div v-if="appStore.drawerOpen" class="g-mask" @click="appStore.closeDrawer()" />

    <LayoutSider
      :collapsed="false"
      :trigger="null"
      :width="264"
      class="g-sider is-drawer"
      :class="{ 'is-open': appStore.drawerOpen }"
    >
      <div class="g-logo">
        <img src="/logo.png" alt="Guoba" class="g-logo-img" />
        <span class="g-logo-text">
          锅巴面板
          <em>v{{ GUOBA_VERSION }} · {{ BUILD_TIME }}</em>
        </span>
        <!-- 抽屉挡住遮罩边缘时不用再瞄准空白处，给一颗明确的关闭按钮 -->
        <button
          type="button"
          class="g-drawer-close"
          title="关闭菜单"
          @click="appStore.closeDrawer()"
        >
          <GIcon icon="ant-design:close-outlined" :size="16" />
        </button>
      </div>

      <div class="g-sider-scroll">
        <SideMenu :collapsed="false" />
      </div>
    </LayoutSider>

    <Layout class="g-main">
      <LayoutHeaderMobile />
      <AppContent />
    </Layout>
  </Layout>
</template>

<style scoped>
.g-layout {
  height: 100vh;
  /* 移动端浏览器地址栏会吃掉高度，有 dvh 就用 dvh */
  height: 100dvh;
  overflow: hidden;
}

/* 抽屉是 fixed 的，主区域要能压到 0 宽以下再撑开，否则窄屏横向溢出 */
.g-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}

/* ---- 侧边栏改为覆盖式抽屉，不占内容宽度 ---- */
.g-sider {
  border-inline-end: 1px solid var(--g-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--g-bg-sider);
}

.g-sider.is-drawer {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: 100;
  /* 内联 width 由 antd 设置，这里用 !important 收窄：320 宽的机器上 264 会顶到边 */
  width: min(264px, 78vw) !important;
  max-width: 78vw;
  transform: translateX(-100%);
  transition: transform 0.24s ease;
  box-shadow: none;
}

.g-sider.is-drawer.is-open {
  transform: translateX(0);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.35);
}

.g-sider :deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.g-mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.45);
}

.g-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 10px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--g-border);
  overflow: hidden;
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

.g-drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 32px;
  height: 32px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--g-text-sub);
  cursor: pointer;
}

.g-drawer-close:active {
  background: var(--g-bg-soft);
}

.g-sider-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
