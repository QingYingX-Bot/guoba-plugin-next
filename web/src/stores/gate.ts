import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiGateUnlock, apiGetGateStatus } from '@/api'
import { GATE_LOCKED_CODE, GATE_REQUIRED_CODE, GATE_TOKEN_STORAGE_KEY } from '@/utils/env'

/**
 * 二级密码状态。
 *
 * 解锁凭证放 sessionStorage：刷新页面不用重输，关掉标签页后下次打开要重新输入。
 * 服务端把凭证和当前登录令牌绑定，换人登录后旧凭证自动失效。
 */
export const useGateStore = defineStore('gate', () => {
  /** 是否已设置二级密码 */
  const configured = ref(false)
  /** 本次浏览器会话是否已解锁 */
  const unlocked = ref(true)
  /** 当前 IP 是否处于锁定状态 */
  const locked = ref(false)
  /** 锁定剩余秒数 */
  const lockSeconds = ref(0)
  /** 是否已经从服务端拿到过状态 */
  const checked = ref(false)
  const gateToken = ref<string>(sessionStorage.getItem(GATE_TOKEN_STORAGE_KEY) ?? '')

  function setGateToken(value: string) {
    gateToken.value = value
    if (value) {
      sessionStorage.setItem(GATE_TOKEN_STORAGE_KEY, value)
    } else {
      sessionStorage.removeItem(GATE_TOKEN_STORAGE_KEY)
    }
  }

  function apply(data: { configured?: boolean; unlocked?: boolean; locked?: boolean; lockSeconds?: number }) {
    configured.value = !!data?.configured
    unlocked.value = !!data?.unlocked
    locked.value = !!data?.locked
    lockSeconds.value = Number(data?.lockSeconds) || 0
    checked.value = true
  }

  /** 向服务端核对当前状态 */
  async function check() {
    const data = await apiGetGateStatus()
    apply(data)
    return data
  }

  /** 输入二级密码，成功后保存解锁凭证 */
  async function unlock(password: string) {
    const data = await apiGateUnlock(password)
    if (data?.gateToken) setGateToken(data.gateToken)
    unlocked.value = true
    locked.value = false
    lockSeconds.value = 0
    checked.value = true
    return data
  }

  /** 设置/修改二级密码后，服务端会顺带发一张解锁凭证 */
  function acceptToken(data: { gateToken?: string } | null | undefined) {
    if (data?.gateToken) {
      setGateToken(data.gateToken)
      unlocked.value = true
      locked.value = false
      lockSeconds.value = 0
    }
    configured.value = true
  }

  /** 收到后端 403 时同步本地状态 */
  function applyBlocked(code: number, data: any) {
    if (code === GATE_LOCKED_CODE) {
      locked.value = true
      unlocked.value = false
      lockSeconds.value = Number(data?.result?.lockSeconds ?? data?.lockSeconds) || lockSeconds.value
    } else if (code === GATE_REQUIRED_CODE) {
      unlocked.value = false
    }
  }

  /** 退出登录时清空（解锁凭证只属于这次登录） */
  function reset() {
    setGateToken('')
    configured.value = false
    unlocked.value = true
    locked.value = false
    lockSeconds.value = 0
    checked.value = false
  }

  return {
    configured,
    unlocked,
    locked,
    lockSeconds,
    checked,
    gateToken,
    check,
    unlock,
    acceptToken,
    applyBlocked,
    reset,
  }
})
