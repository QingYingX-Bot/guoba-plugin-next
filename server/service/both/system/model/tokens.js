import crypto from 'node:crypto'

/**
 * 弱令牌：只能读主题背景、自定义页面资源、插件图标这类静态内容。
 *
 * 原来用 randomString（lodash.random / Math.random），不是密码学安全的随机源；
 * 长度仍是 8 位（拦截器按长度识别），字符集 base64url 对 URL 友好。
 */
export const liteToken = crypto.randomBytes(6).toString('base64url').slice(0, 8)
