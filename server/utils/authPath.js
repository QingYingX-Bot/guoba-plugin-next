import path from 'node:path'
import { _paths } from '#guoba.platform'

/**
 * 鉴权用的路径归一化。
 *
 * Express 的路由匹配默认**不区分大小写**，但拦截器如果拿原样字符串做正则匹配，
 * 就会出现 `/api/login` 被拦、`/API/login` 直接放行的错位 —— 这条口子被真实利用过，
 * 未登录者用它改了面板账号密码、绕过了二级密码。
 *
 * 这里统一把路径转小写、解码百分号转义、剥掉锅巴挂载前缀，再做一次 posix 规范化，
 * 让「鉴权看到的路径」和「路由实际匹配的路径」始终指向同一个东西。
 * 宁可比路由更严格，也不能比路由更宽松。
 *
 * @param {import('express').Request} req
 * @return {string} 以小写 / 开头、已剥掉挂载前缀的路径
 */
export function normalizeAuthPath(req) {
  let raw = typeof req?.path === 'string' && req.path ? req.path : (req?.url || '/')
  // 路由按解码后的路径匹配，鉴权也得先解码（%61pi 必须当成 api）
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 解码失败就按原样判断，不能因此放行
  }
  const noQuery = raw.split('?')[0].split('#')[0]
  let result = path.posix.normalize(noQuery.toLowerCase())
  const prefix = String(_paths.server.realMountPrefix || '').toLowerCase()
  // 剥掉挂载前缀（大小写无关）
  if (prefix && prefix !== '/') {
    if (result === prefix) {
      result = '/'
    } else if (result.startsWith(prefix + '/')) {
      result = result.substring(prefix.length)
    }
  }
  result = path.posix.normalize(result)
  if (!result.startsWith('/')) result = '/' + result
  return result
}

/** 路径是否命中正则（大小写已在 normalizeAuthPath 里统一） */
export function matchAuthPath(reg, req) {
  return reg.test(normalizeAuthPath(req))
}
