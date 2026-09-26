import {isV3, isV4} from '#guoba.adapter'
import {checkPackage} from './utils/adapter/check.js'
import {createImport, GI, GID} from './utils/guobaImport.js'

// JiuLi 等宿主可能没有 oicq，这里做容错
if (!global.segment) {
  try {
    global.segment = (await import("oicq")).segment
  } catch (e) {
    // 宿主没有 oicq 时，提供一个最小可用的 segment 实现
    // JiuLi / TRSS 系通常有自己的 segment，会覆盖此实现
    global.segment = {
      at: (qq, name) => ({ type: 'at', qq, name }),
      image: (url) => ({ type: 'image', url }),
      text: (text) => ({ type: 'text', text }),
      face: (id) => ({ type: 'face', id }),
      record: (url) => ({ type: 'record', url }),
      video: (url) => ({ type: 'video', url }),
      file: (url) => ({ type: 'file', url }),
      location: (lat, lng, title, content) => ({ type: 'location', lat, lng, title, content }),
      share: (url, title, content, image) => ({ type: 'share', url, title, content, image }),
      reply: (id) => ({ type: 'reply', id }),
      forward: (id) => ({ type: 'forward', id }),
      node: (data) => ({ type: 'node', data }),
      xml: (data) => ({ type: 'xml', data }),
      json: (data) => ({ type: 'json', data }),
      markdown: (data) => ({ type: 'markdown', data }),
      custom: (type, data) => ({ type, ...data }),
    }
  }
}

let passed = await checkPackage()

if (!passed) {
  throw 'Missing necessary dependencies'
}

global.Guoba = {GI, GID, createImport}

const apps = {}, rule = {}

let appRouter = null

if (isV3 || isV4) {
  await (await import('./utils/adapter/initV3.js')).init(apps)
} else {
  appRouter = await (await import('./utils/adapter/initV2.js')).init(rule)
}

export {apps, rule, appRouter}
