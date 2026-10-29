<script setup lang="ts">
/**
 * 顶栏 · PC 版。
 *
 * 左侧折叠按钮 + 面包屑，右侧主题和账号菜单（HeaderActions）。手机端用
 * LayoutHeaderMobile：那套不放面包屑，只显示当前页名。
 */
import { computed } from 'vue'
import { Breadcrumb, BreadcrumbItem, Button, LayoutHeader as AHeader } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import HeaderActions from './HeaderActions.vue'
import { useBreadcrumbs } from './useBreadcrumbs'

const appStore = useAppStore()
const collapsed = computed(() => appStore.sidebarCollapsed)
const { breadcrumbs } = useBreadcrumbs()
</script>

<template>
  <AHeader class="g-header">
    <div class="g-header-left">
      <!-- 窄屏的桌面版里侧栏固定收成图标条，这个按钮点了也没用，干脆不显示 -->
      <Button
        v-if="!appStore.viewportNarrow"
        type="text"
        class="g-icon-btn"
        @click="appStore.toggleSidebar()"
      >
        <GIcon
          :icon="collapsed ? 'ant-design:menu-unfold-outlined' : 'ant-design:menu-fold-outlined'"
          :size="17"
        />
      </Button>

      <Breadcrumb v-if="breadcrumbs.length" class="g-breadcrumb">
        <BreadcrumbItem v-for="(item, idx) in breadcrumbs" :key="idx">
          {{ item }}
        </BreadcrumbItem>
      </Breadcrumb>
    </div>

    <HeaderActions />
  </AHeader>
</template>

<style scoped>
.g-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px 0 8px;
  line-height: 56px;
  border-bottom: 1px solid var(--g-border);
  background: var(--g-bg-header);
  flex-shrink: 0;
}

.g-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.g-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--g-text-sub);
}

.g-breadcrumb {
  margin-left: 4px;
  font-size: 13px;
}

/* 手动强制桌面版但屏幕本身很窄时，面包屑别把账号区挤出去 */
@media (max-width: 768px) {
  .g-header {
    padding: 0 8px 0 4px;
  }

  .g-breadcrumb {
    max-width: 42vw;
    overflow: hidden;
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
