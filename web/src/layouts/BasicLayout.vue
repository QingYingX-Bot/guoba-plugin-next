<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Checkbox, Layout, LayoutContent, LayoutSider, Modal } from 'ant-design-vue'
import SideMenu from './components/SideMenu.vue'
import LayoutHeader from './components/LayoutHeader.vue'
import { useAppStore } from '@/stores/app'
import { useGateStore } from '@/stores/gate'
import { GUOBA_VERSION, ICP_NO, isGateTipMuted, setGateTipMuted } from '@/utils/env'

const appStore = useAppStore()
const gate = useGateStore()
const route = useRoute()
const router = useRouter()

/** 本次浏览器会话已经提醒过设置二级密码 */
const GATE_TIP_KEY = 'guoba:gate-tip-shown'

/** 「尚未设置二级密码」提示是否正在展示 */
const gateTipOpen = ref(false)
/** 「以后不再提醒」：勾上立即写进 localStorage，跨浏览器会话一直生效 */
const gateTipMute = ref(isGateTipMuted())

watch(gateTipMute, (value) => {
  setGateTipMuted(value)
})

function closeGateTip() {
  gateTipOpen.value = false
}

function goGateSecurity() {
  gateTipOpen.value = false
  void router.push('/account/security')
}

const isMobile = computed(() => appStore.isMobile)
// 窄屏抽屉里始终展示完整菜单，收窄态只在宽屏生效
const collapsed = computed(() => !isMobile.value && appStore.sidebarCollapsed)
const siderWidth = computed(() => (isMobile.value ? 232 : 220))

/**
 * 还没设置二级密码时提醒一次。
 *
 * 二级密码是选填项，未设置时四个敏感页面是直接放行的，
 * 不提醒的话很容易以为这套保护已经生效了。
 * 弹窗里勾了「以后不再提醒」就永久不再弹，可在「登录安全」页重新打开。
 */
async function promptGateSetup() {
  if (isGateTipMuted()) return
  try {
    await gate.check()
  } catch {
    return
  }
  if (gate.configured) return
  if (sessionStorage.getItem(GATE_TIP_KEY)) return
  sessionStorage.setItem(GATE_TIP_KEY, '1')
  gateTipOpen.value = true
}

onMounted(() => {
  appStore.setupResponsive()
  void promptGateSetup()
})

// 窄屏点菜单跳转后顺手收起抽屉
watch(() => route.fullPath, () => {
  if (isMobile.value) appStore.closeDrawer()
})
</script>

<template>
  <Layout class="g-layout" :class="{ 'is-mobile': isMobile }">
    <div
      v-if="isMobile && appStore.drawerOpen"
      class="g-mask"
      @click="appStore.closeDrawer()"
    />

    <LayoutSider
      :collapsed="collapsed"
      :collapsedWidth="64"
      :width="siderWidth"
      :trigger="null"
      collapsible
      class="g-sider"
      :class="{ 'is-drawer': isMobile, 'is-open': isMobile && appStore.drawerOpen }"
    >
      <div class="g-logo" :class="{ 'is-collapsed': collapsed }">
        <img src="/logo.png" alt="Guoba" class="g-logo-img" />
        <span v-if="!collapsed" class="g-logo-text">
          锅巴面板
          <em>v{{ GUOBA_VERSION }}</em>
        </span>
      </div>

      <div class="g-sider-scroll">
        <SideMenu :collapsed="collapsed" />
      </div>
    </LayoutSider>

    <Layout class="g-main">
      <LayoutHeader />

      <LayoutContent class="g-content">
        <RouterView v-slot="{ Component }">
          <Transition name="g-fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </RouterView>

        <footer v-if="ICP_NO" class="g-footer">{{ ICP_NO }}</footer>
      </LayoutContent>
    </Layout>

    <Modal
      v-model:open="gateTipOpen"
      :title="null"
      :footer="null"
      :closable="false"
      :maskClosable="false"
      :width="400"
      centered
      class="g-gate-tip"
    >
      <div class="g-gate-tip-head">
        <span class="g-gate-tip-icon">!</span>
        <span class="g-gate-tip-title">尚未设置二级密码</span>
      </div>
      <p class="g-gate-tip-desc">
        开启后，进入文件管理、数据浏览、终端和消息记录需要再验证一次。现在去设置吗？
      </p>
      <Checkbox v-model:checked="gateTipMute" class="g-gate-tip-mute">以后不再提醒</Checkbox>
      <div class="g-gate-tip-actions">
        <Button @click="closeGateTip">稍后再说</Button>
        <Button type="primary" @click="goGateSecurity">去设置</Button>
      </div>
    </Modal>
  </Layout>
</template>

<style scoped>
.g-layout {
  height: 100vh;
  /* 移动端浏览器地址栏会吃掉高度，有 dvh 就用 dvh */
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

/* ---- 窄屏：侧边栏改为覆盖式抽屉，不占内容宽度 ---- */
.g-sider.is-drawer {
  position: fixed;
  inset-block: 0;
  inset-inline-start: 0;
  z-index: 100;
  transform: translateX(-100%);
  transition: transform 0.24s ease;
  box-shadow: none;
}

.g-sider.is-drawer.is-open {
  transform: translateX(0);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.35);
}

.g-mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.45);
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

.g-content {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.g-footer {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--g-text-dim);
}

/* 抽屉是 fixed 的，主区域要能压到 0 宽以下再撑开，否则窄屏横向溢出 */
.g-layout.is-mobile .g-main {
  min-width: 0;
  width: 100%;
}

/* ---- 「尚未设置二级密码」提示 ---- */
.g-gate-tip-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.g-gate-tip-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #d99b3d;
  color: #1b1b1b;
  font-size: 15px;
  font-weight: 700;
  line-height: 22px;
  text-align: center;
}

.g-gate-tip-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text);
}

.g-gate-tip-desc {
  margin: 12px 0 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--g-text-dim);
}

.g-gate-tip-mute {
  font-size: 13px;
  color: var(--g-text-dim);
}

.g-gate-tip-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
