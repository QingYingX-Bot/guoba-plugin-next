<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Spin } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { apiGetFrozenStatus } from '@/api'
import { TOKEN_STORAGE_KEY } from '@/utils/env'

/**
 * 面板冻结页。
 *
 * 登录密码或二级密码连续输错 3 次后整个面板冻结，
 * 只有主人在聊天里发送「#锅巴解冻」才能恢复。
 * 这里每 5 秒查一次状态，解冻后自动回登录页。
 */
const router = useRouter()

const loading = ref(true)
const frozen = ref(true)
const reason = ref('')
const frozenAt = ref(0)
const error = ref('')
let timer: number | undefined

const timeText = computed(() => {
  if (!frozenAt.value) return ''
  const d = new Date(frozenAt.value)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})

async function refresh() {
  try {
    const status = await apiGetFrozenStatus()
    frozen.value = !!status.frozen
    reason.value = status.reason || ''
    frozenAt.value = status.at || 0
    error.value = ''
    if (!status.frozen) {
      stopTimer()
      // 登录态还在就直接回首页（失效的话首页会自己把用户送回登录页）
      const hasToken = !!localStorage.getItem(TOKEN_STORAGE_KEY)
      router.replace(hasToken ? '/home' : '/login')
    }
  } catch (e: any) {
    error.value = e?.message || '无法获取冻结状态，请稍后重试'
  } finally {
    loading.value = false
  }
}

function stopTimer() {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => void refresh(), 5000)
})
onUnmounted(stopTimer)
</script>

<template>
  <main class="g-frozen">
    <section class="g-frozen-card">
      <Spin :spinning="loading">
        <div class="g-frozen-icon">
          <GIcon icon="ant-design:safety-outlined" :size="30" />
        </div>
        <h1 class="g-frozen-title">锅巴已冻结</h1>
        <p class="g-frozen-reason">{{ reason || '密码错误次数过多' }}</p>
        <p v-if="timeText" class="g-frozen-time">冻结时间：{{ timeText }}</p>
        <p v-if="error" class="g-frozen-error">{{ error }}</p>

        <div class="g-frozen-tip">
          请主人私聊机器人发送 <strong>#锅巴解冻</strong> 解除，
          解除后即可重新打开面板输入账号密码。
        </div>

        <Button type="primary" size="large" block :loading="loading" @click="refresh">
          重新检查
        </Button>
        <p class="g-frozen-auto">页面每 5 秒自动检查，解冻后会自动跳到登录页</p>
      </Spin>
    </section>
  </main>
</template>

<style scoped>
.g-frozen {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--g-bg);
}

.g-frozen-card {
  width: 100%;
  max-width: 460px;
  padding: 30px 28px 26px;
  border: 1px solid var(--g-border);
  border-radius: 14px;
  background: var(--g-bg-card);
  box-shadow: var(--g-shadow);
  text-align: center;
}

.g-frozen-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  border-radius: 50%;
  color: var(--g-danger);
  background: rgba(217, 97, 76, 0.14);
}

.g-frozen-title {
  margin: 0 0 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--g-text);
}

.g-frozen-reason {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--g-danger);
}

.g-frozen-time {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--g-text-dim);
  font-variant-numeric: tabular-nums;
}

.g-frozen-error {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--g-danger);
}

.g-frozen-tip {
  margin: 6px 0 20px;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
  text-align: left;
  color: var(--g-text-sub);
  background: var(--g-bg-soft);
}

.g-frozen-tip strong {
  color: var(--g-text);
}

.g-frozen-auto {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--g-text-dim);
}
</style>
