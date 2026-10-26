<script setup lang="ts">
/**
 * 主内容区：页面渲染 + 页脚 + 「尚未设置二级密码」提示。
 *
 * PC 和手机两套布局共用这一块，差异只在外面那层壳（侧栏 vs 抽屉）。
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Checkbox, LayoutContent, Modal } from 'ant-design-vue'
import { useGateStore } from '@/stores/gate'
import { ICP_NO, isGateTipMuted, setGateTipMuted } from '@/utils/env'

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
  void promptGateSetup()
})
</script>

<template>
  <LayoutContent class="g-content">
    <RouterView v-slot="{ Component }">
      <Transition name="g-fade" mode="out-in">
        <component :is="Component" :key="route.fullPath" />
      </Transition>
    </RouterView>

    <footer v-if="ICP_NO" class="g-footer">{{ ICP_NO }}</footer>

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
  </LayoutContent>
</template>

<style scoped>
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
