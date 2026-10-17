<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Input, Spin, message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { useGateStore } from '@/stores/gate'

/**
 * 二级密码锁屏。
 *
 * 进入文件管理 / 数据浏览 / 终端 / 消息记录前会先到这个页面；
 * 输错次数过多时（连沙盒、运行日志一起）也停在这里等倒计时结束。
 */
const route = useRoute()
const router = useRouter()
const gate = useGateStore()

const password = ref('')
const loading = ref(true)
const submitting = ref(false)
const errorText = ref('')
const remaining = ref(0)
/** 服务端状态没拿到时的提示 */
const loadError = ref('')

let timer: number | undefined

const redirect = computed(() => {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  // 只接受站内路径，且不能回自己
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/gate')) return '/home'
  return value
})

const countdownText = computed(() => {
  const total = Math.max(0, remaining.value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds} 秒`
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
})

function stopCountdown() {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function startCountdown() {
  stopCountdown()
  if (remaining.value <= 0) return
  timer = window.setInterval(() => {
    if (remaining.value > 0) remaining.value -= 1
    if (remaining.value <= 0) {
      stopCountdown()
      void refresh()
    }
  }, 1000)
}

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const status = await gate.check()
    remaining.value = status.locked ? status.lockSeconds : 0
    if (status.locked) {
      startCountdown()
    }
    // 没开二级密码、或者本次会话已经解锁过，就不用停在这
    if (!status.locked && (!status.configured || status.unlocked)) {
      router.replace(redirect.value)
    }
  } catch (error: any) {
    loadError.value = error?.message || '无法获取二级密码状态，请刷新重试'
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!password.value) {
    message.warning('请输入二级密码')
    return
  }
  submitting.value = true
  errorText.value = ''
  try {
    await gate.unlock(password.value)
    password.value = ''
    message.success('已解锁')
    router.replace(redirect.value)
  } catch (error: any) {
    errorText.value = error?.message || '二级密码错误'
    // 错误次数可能刚好触发锁定，重新同步一次状态
    try {
      const status = await gate.check()
      remaining.value = status.locked ? status.lockSeconds : 0
      if (status.locked) startCountdown()
    } catch {
      // 拿不到状态就只显示错误文案
    }
  } finally {
    submitting.value = false
  }
}

onMounted(refresh)
onUnmounted(stopCountdown)
</script>

<template>
  <div class="g-gate">
    <div class="g-gate-card">
      <Spin :spinning="loading">
        <template v-if="loadError">
          <div class="g-gate-icon"><GIcon icon="ant-design:info-circle-outlined" :size="28" /></div>
          <h2 class="g-gate-title">无法验证身份</h2>
          <p class="g-gate-desc">{{ loadError }}</p>
          <Button type="primary" block @click="refresh">重试</Button>
        </template>

        <template v-else-if="gate.locked">
          <div class="g-gate-icon is-locked"><GIcon icon="ant-design:close-outlined" :size="28" /></div>
          <h2 class="g-gate-title">功能已锁定</h2>
          <p class="g-gate-desc">
            密码错误次数过多，文件管理、数据浏览、终端、消息记录，
            以及沙盒和运行日志暂时都不能使用。
          </p>
          <div class="g-gate-countdown">{{ countdownText }}后自动恢复</div>
        </template>

        <template v-else-if="!gate.configured">
          <div class="g-gate-icon"><GIcon icon="ant-design:safety-outlined" :size="28" /></div>
          <h2 class="g-gate-title">尚未设置二级密码</h2>
          <p class="g-gate-desc">请先到「登录安全」页面开启二级密码。</p>
          <Button type="primary" block @click="router.replace('/account/security')">去设置</Button>
        </template>

        <template v-else>
          <div class="g-gate-icon"><GIcon icon="ant-design:safety-outlined" :size="28" /></div>
          <h2 class="g-gate-title">此功能需要二级密码</h2>
          <p class="g-gate-desc">请输入二级密码后继续浏览。</p>
          <Input.Password
            v-model:value="password"
            size="large"
            placeholder="二级密码"
            autocomplete="off"
            :disabled="submitting"
            @press-enter="submit"
          >
            <template #prefix><GIcon icon="ant-design:key-outlined" :size="16" /></template>
          </Input.Password>
          <p v-if="errorText" class="g-gate-error">{{ errorText }}</p>
          <Button type="primary" size="large" block :loading="submitting" @click="submit">
            解锁
          </Button>
        </template>
      </Spin>
    </div>
  </div>
</template>

<style scoped>
.g-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 32px 16px;
}

.g-gate-card {
  width: 100%;
  max-width: 420px;
  padding: 28px 26px 26px;
  border: 1px solid var(--g-border);
  border-radius: 12px;
  background: var(--g-bg-card, var(--g-bg));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  text-align: center;
}

.g-gate-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
  border-radius: 50%;
  color: var(--g-brand);
  background: var(--g-brand-soft);
}

.g-gate-icon.is-locked {
  color: var(--g-danger);
  background: rgba(217, 97, 76, 0.14);
}

.g-gate-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--g-text);
}

.g-gate-desc {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--g-text-dim);
}

.g-gate-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--g-danger);
}

.g-gate-countdown {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--g-danger);
  font-variant-numeric: tabular-nums;
}

.g-gate-card :deep(.ant-input-affix-wrapper) {
  margin-bottom: 16px;
}
</style>
