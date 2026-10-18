import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { message } from 'ant-design-vue'
import {
  API_BASE,
  TOKEN_KEY,
  GATE_TOKEN_KEY,
  GATE_REQUIRED_CODE,
  GATE_LOCKED_CODE,
  GATE_FAILED_CODE,
  FROZEN_CODE,
} from '@/utils/env'
import { deviceHeaders } from '@/utils/device'

/** 后端统一返回结构，见 framework/src/components/Result.js 的 toJSON() */
export interface ApiResult<T = any> {
  ok: boolean
  code: number
  result: T
  message: string
}

export interface RequestOptions {
  /** 失败时是否自动弹出错误提示，默认 true */
  showError?: boolean
  /** 成功时是否自动弹出后端返回的 message，默认 false */
  showSuccess?: boolean
  /** 为 true 时返回完整 ApiResult，而不是只取 result */
  raw?: boolean
}

const http = axios.create({
  baseURL: API_BASE,
  timeout: 60_000,
})

/** token 由 auth store 注入，避免此处直接依赖 store 造成循环引用 */
let tokenGetter: () => string | undefined = () => undefined
/** 二级密码解锁凭证，同样由 store 注入 */
let gateTokenGetter: () => string | undefined = () => undefined
/** 401 处理回调，由 store 注册 */
let unauthorizedHandler: () => void = () => undefined
/** 二级密码拦截回调：需要密码，由 main.ts 跳到锁屏页 */
let gateBlockedHandler: (code: number, data: any) => void = () => undefined
/** 面板冻结回调：由 main.ts 跳到冻结页 */
let frozenHandler: () => void = () => undefined

/**
 * 401 提示 / 跳转的去重窗口（毫秒）。
 *
 * 页面一次会并发好几个请求（用户信息、权限、菜单…），令牌一过期就一起 401，
 * 不去重的话会连弹好几条「登录已失效」、跳好几次登录页。
 */
const UNAUTHORIZED_DEBOUNCE = 3000
let lastUnauthorizedAt = 0

export function setTokenGetter(fn: () => string | undefined) {
  tokenGetter = fn
}

export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn
}

export function setGateTokenGetter(fn: () => string | undefined) {
  gateTokenGetter = fn
}

export function setGateBlockedHandler(fn: (code: number, data: any) => void) {
  gateBlockedHandler = fn
}

export function setFrozenHandler(fn: () => void) {
  frozenHandler = fn
}

/** 统一的 401 处理：一个窗口内只提示并跳转一次 */
function handleUnauthorized(text?: string) {
  const now = Date.now()
  if (now - lastUnauthorizedAt < UNAUTHORIZED_DEBOUNCE) return
  lastUnauthorizedAt = now
  message.error(text || '登录已失效，请重新登录')
  unauthorizedHandler()
}

http.interceptors.request.use((config) => {
  const token = tokenGetter()
  if (token) {
    config.headers.set(TOKEN_KEY, token)
  }
  // 二级密码解锁凭证：受保护接口靠它放行
  const gateToken = gateTokenGetter()
  if (gateToken) {
    config.headers.set(GATE_TOKEN_KEY, gateToken)
  }
  // 设备凭证与指纹：登录相关接口靠它免掉验证码，其余接口只是顺带带上，后端不看
  for (const [key, value] of Object.entries(deviceHeaders())) {
    if (value) config.headers.set(key, value)
  }
  return config
})

http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status
    const data = error?.response?.data
    // 面板冻结：所有接口（含登录）都会 423，统一切到冻结页
    if (status === 423 || Number(data?.code) === FROZEN_CODE) {
      try {
        frozenHandler()
      } catch {
        // 回调出错不影响请求本身的失败处理
      }
      const frozen = new Error(data?.message || '锅巴已冻结') as Error & {
        frozen?: boolean
        status?: number
        code?: number
      }
      frozen.frozen = true
      frozen.status = 423
      frozen.code = FROZEN_CODE
      return Promise.reject(frozen)
    }
    // 401 统一跳登录，其余错误交给调用方处理
    if (status === 401) {
      // 二级密码输错会把当前登录直接作废，用后端那句「已退出登录」当提示
      const kicked = Number(data?.code) === GATE_FAILED_CODE
      const text = kicked ? data?.message : undefined
      handleUnauthorized(text)
      // 打上标记，避免下面 request() 再弹一遍同样的提示
      const unauthorized = new Error(text || '登录已失效，请重新登录') as Error & {
        unauthorized?: boolean
        status?: number
        code?: number
      }
      unauthorized.unauthorized = true
      unauthorized.status = 401
      unauthorized.code = Number(data?.code)
      return Promise.reject(unauthorized)
    }
    // 二级密码：需要密码（4232 是旧版锁定码，保留兼容），交给 main.ts 里的回调切到锁屏页
    if (status === 403) {
      const code = Number(data?.code)
      if (code === GATE_REQUIRED_CODE || code === GATE_LOCKED_CODE) {
        try {
          gateBlockedHandler(code, data)
        } catch {
          // 回调出错不影响请求本身的失败处理
        }
        const blocked = new Error(data?.message || '此功能需要二级密码') as Error & {
          gateBlocked?: boolean
          status?: number
          code?: number
        }
        blocked.gateBlocked = true
        blocked.status = 403
        blocked.code = code
        return Promise.reject(blocked)
      }
    }
    return Promise.reject(error)
  },
)

/** 带 HTTP 状态码的请求异常，调用方可据此区分 404（如接口未注册）等情况 */
export class ApiError extends Error {
  status?: number
  code?: number

  constructor(message: string, status?: number, code?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 从各种异常里提炼出可展示的文案 */
function normalizeError(error: any): string {
  const data = error?.response?.data
  if (data && typeof data === 'object' && typeof data.message === 'string') {
    return data.message
  }
  if (error?.code === 'ECONNABORTED') return '请求超时，请稍后重试'
  if (error?.response?.status === 404) return '接口不存在（404）'
  return error?.message || '请求失败'
}

export async function request<T = any>(
  config: AxiosRequestConfig,
  options: RequestOptions = {},
): Promise<T> {
  const { showError = true, showSuccess = false, raw = false } = options
  try {
    const resp: AxiosResponse<ApiResult<T>> = await http.request(config)
    const data = resp.data
    // 少数接口（如直接 sendFile）不返回标准结构，原样透出
    if (!data || typeof data !== 'object' || !('ok' in data)) {
      return data as unknown as T
    }
    if (!data.ok) {
      throw new ApiError(data.message || '请求失败', resp.status, data.code)
    }
    if (showSuccess && data.message && data.message !== 'ok') {
      message.success(data.message)
    }
    return (raw ? data : data.result) as T
  } catch (error: any) {
    const text = normalizeError(error)
    // 401 已经在拦截器里统一提示过了，这里不再重复弹
    // 二级密码拦下的请求会切到锁屏页、冻结会切到冻结页，也不弹普通错误提示
    if (showError && !error?.unauthorized && !error?.gateBlocked && !error?.frozen) {
      message.error(text)
    }
    throw new ApiError(text, error?.status ?? error?.response?.status, error?.code ?? error?.response?.data?.code)
  }
}

export const get = <T = any>(url: string, params?: any, options?: RequestOptions) =>
  request<T>({ url, method: 'get', params }, options)

export const post = <T = any>(url: string, data?: any, options?: RequestOptions) =>
  request<T>({ url, method: 'post', data }, options)

export const put = <T = any>(url: string, data?: any, options?: RequestOptions) =>
  request<T>({ url, method: 'put', data }, options)

export const del = <T = any>(url: string, data?: any, options?: RequestOptions) =>
  request<T>({ url, method: 'delete', data }, options)

export default http
