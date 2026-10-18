import {autowired} from '#guoba.framework'
import {GuobaSupportMap} from '#guoba.platform'
import {getPluginIconPath} from '../../../../../utils/pluginUtils.js'

/**
 * 自定义页面的菜单。
 *
 * 「扩展页面」下固定有一个「页面管理」入口（在面板里建页面用），
 * 后面跟着已注册的页面 —— 插件的和面板里建的都在这。
 * icon 允许直接写 emoji，前端 GIcon 认不出 iconify 名时会按文本渲染。
 */
export async function useCustomPagesMenu() {
  const customPageService = autowired('customPageService')
  await customPageService.loading
  const pages = customPageService.getPages()
  const children = [{
    path: '/custom/manage',
    name: 'CustomPageManage',
    component: '/guoba/custom/manage',
    meta: {
      title: '页面管理',
      icon: 'ant-design:appstore-add-outlined',
    },
  }]
  // 本地定制：插件自带的页面按插件分组，形成「扩展页面 → 插件 → 页面」三级菜单。
  const toMenuItem = (page) => ({
    path: `/custom/${page.id}`,
    name: 'CustomPage_' + page.id,
    component: '/guoba/custom/index',
    meta: {
      title: page.title,
      icon: page.icon || 'ant-design:file-text-outlined',
      ignoreRoute: true,
    },
    guobaMeta: {
      customPage: {id: page.id, source: page.source, pluginName: page.pluginName},
    },
  })
  const groups = new Map()
  for (const page of pages) {
    if (page.pluginName) {
      if (!groups.has(page.pluginName)) groups.set(page.pluginName, [])
      groups.get(page.pluginName).push(toMenuItem(page))
    } else {
      children.push(toMenuItem(page))
    }
  }
  for (const [pluginName, items] of groups) {
    const info = GuobaSupportMap.get(pluginName)?.pluginInfo
    children.push({
      path: `/custom/plugin/${pluginName}`,
      name: `CustomPlugin_${pluginName}`,
      component: '/guoba/custom/manage',
      meta: {
        title: pluginName,
        icon: info?.icon ?? 'ant-design:appstore-outlined',
        ignoreRoute: true,
      },
      // 与「插件配置」菜单一致：前端按 guobaMeta.plugin 渲染插件自己的图标
      guobaMeta: {
        plugin: {
          name: pluginName,
          icon: info?.icon,
          iconColor: info?.iconColor,
          iconPath: getPluginIconPath(info),
        },
      },
      redirect: items[0]?.path,
      children: items,
    })
  }
  // 占位路由，跟插件详情一样，让前端 /custom/:id 这条静态路由在菜单里有对应项
  children.push({
    path: '/custom/:id',
    name: 'CustomPage',
    component: '/guoba/custom/index',
    meta: {title: '扩展页面', hideMenu: true},
  })
  return [{
    path: '/custom',
    name: 'CustomPageParent',
    component: '/guoba/custom/index',
    meta: {
      title: '扩展页面',
      icon: 'ant-design:block-outlined',
    },
    redirect: children[0].path,
    children,
  }]
}
