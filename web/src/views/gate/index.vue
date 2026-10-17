<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Input, Spin, message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { apiResetGatePassword } from '@/api'
import { useGateStore } from '@/stores/gate'

/**
 * 二级密码锁屏。
 *
 * 进入文件管理 / 数据浏览 / 终端 / 消息记录 / 账号管理前先到这里验证；
 * 连续输错 3 次会冻结整个面板（跳到 /frozen），不再在本地倒计时。
 */
const route = useRoute()
const router = useRouter()
const gate = useGateStore()

const password = ref('')
const loading = ref(true)
const submitting = ref(false)
const errorText = ref('')
/** 服务端状态没拿到时的提示 */
const loadError = ref('')

/** 解锁 / 忘记密码时的重置 */
const mode = ref<'unlock' | 'reset'>('unlock')
const resetting = ref(false)
const resetError = ref('')
const resetForm = reactive({ loginPassword: '', password: '', confirmPassword: '' })

const redirect = computed(() => {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  // 只接受站内路径，且不能回自己
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/gate')) return '/home'
  return value
})

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const status = await gate.check()
    // 没开二级密码、或者本次会话已经解锁过，就不用停在这
    if (!status.configured || status.unlocked) {
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
  } finally {
    submitting.value = false
  }
}

/** 打开「忘记二级密码」的重置表单 */
function openReset() {
  mode.value = 'reset'
  resetError.value = ''
  resetForm.loginPassword = ''
  resetForm.password = ''
  resetForm.confirmPassword = ''
}

function backToUnlock() {
  mode.value = 'unlock'
  resetError.value = ''
}

/** 用登录密码重置二级密码 */
async function submitReset() {
  if (!resetForm.loginPassword) {
    message.warning('请输入当前登录密码')
    return
  }
  if (!resetForm.password) {
    message.warning('请输入新二级密码')
    return
  }
  if (resetForm.password.length < 8 || resetForm.password.length > 128) {
    message.warning('新二级密码须为8至128位')
    return
  }
  if (resetForm.password !== resetForm.confirmPassword) {
    message.warning('两次输入的二级密码不一致')
    return
  }
  resetting.value = true
  resetError.value = ''
  try {
    await apiResetGatePassword({
      loginPassword: resetForm.loginPassword,
      password: resetForm.password,
    })
    // 重置后不自动解锁，继续用新密码验证
    gate.lockNow()
    mode.value = 'unlock'
    password.value = ''
    resetForm.loginPassword = ''
    resetForm.password = ''
    resetForm.confirmPassword = ''
    message.success('二级密码已重置，请用新密码解锁')
  } catch (error: any) {
    resetError.value = error?.message || '重置失败'
  } finally {
    resetting.value = false
  }
}

onMounted(refresh)
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


        <template v-else-if="!gate.configured">
          <div class="g-gate-icon"><GIcon icon="ant-design:safety-outlined" :size="28" /></div>
          <h2 class="g-gate-title">尚未设置二级密码</h2>
          <p class="g-gate-desc">请先到「登录安全」页面开启二级密码。</p>
          <Button type="primary" block @click="router.replace('/account/security')">去设置</Button>
        </template>

        <template v-else-if="mode === 'reset'">
          <div class="g-gate-icon"><GIcon icon="ant-design:safety-outlined" :size="28" /></div>
          <h2 class="g-gate-title">重置二级密码</h2>
          <p class="g-gate-desc">输入当前登录密码，并设置一个新的二级密码。</p>
          <Input.Password
            v-model:value="resetForm.loginPassword"
            size="large"
            placeholder="当前登录密码"
            autocomplete="current-password"
            :disabled="resetting"
          />
          <Input.Password
            v-model:value="resetForm.password"
            size="large"
            placeholder="新二级密码（8 位或以上）"
            autocomplete="new-password"
            :disabled="resetting"
          />
          <Input.Password
            v-model:value="resetForm.confirmPassword"
            size="large"
            placeholder="确认新二级密码"
            autocomplete="new-password"
            :disabled="resetting"
            @press-enter="submitReset"
          />
          <p v-if="resetError" class="g-gate-error">{{ resetError }}</p>
          <Button type="primary" size="large" block :loading="resetting" @click="submitReset">
            重置二级密码
          </Button>
          <button type="button" class="g-gate-link" @click="backToUnlock">返回输入密码</button>
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
          <button type="button" class="g-gate-link" @click="openReset">
            忘记二级密码？用登录密码重置
          </button>
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


.g-gate-card :deep(.ant-input-affix-wrapper) {
  margin-bottom: 16px;
}

.g-gate-link {
  margin-top: 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-text-dim);
  font-size: 12px;
  cursor: pointer;
}

.g-gate-link:hover {
  color: var(--g-brand);
}
</style>
