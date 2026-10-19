import {GuobaSupportMap, PluginsMap} from '#guoba.platform'
import {autowired} from '#guoba.framework'
import {getPluginIconPath, parseShowInMenu} from '../../../../../utils/pluginUtils.js'

const pluginsStoreMenu = {
  path: '/plugins',
  name: 'PluginsStore',
  component: '/guoba/plugins/index',
  meta: {
    title: '插件管理',
    // 面板自身的菜单统一用 ant-design 图标集：前端已内置（icons/offline.ts），
    // 不走 iconify 公共 API，离线可用且能跟随菜单选中色。
    // 插件自己声明的 icon 仍按插件作者写的解析，不在此限。
    icon: 'ant-design:appstore-outlined',
  },
}

const pluginsIndexMenu = {
  path: '/plugins/index',
  name: 'PluginsIndex',
  component: '/guoba/plugins/index',
  meta: {
    title: '插件列表',
    icon: 'ant-design:unordered-list-outlined',
  },
}

// 插件的菜单
// noinspection JSUnusedGlobalSymbols
export async function usePluginsMenu() {
  const pluginMenus = []
  // 遍历所有插件
  GuobaSupportMap.forEach((value, name) => {
    if (!parseShowInMenu(value)) {
      return
    }

    // 有 web/pages.json 的插件：二级只做展开，三级 = 插件配置 + 插件页面
    const webPages = autowired('pluginWebService')?.getPages(name) || []
    const node = {
      path: `/plugin/@/${name}`,
      name: 'PluginDetail_' + name,
      component: `/guoba/plugins/plugin-detail/index`,
      meta: {
        title: value.pluginInfo?.title ?? name,
        icon: value.pluginInfo?.icon ?? 'ant-design:appstore-outlined',
        ignoreRoute: true,
      },
      guobaMeta: {
        plugin: {
          name: name,
          icon: value.pluginInfo?.icon,
          iconColor: value.pluginInfo?.iconColor,
          iconPath: getPluginIconPath(value.pluginInfo),
        },
      },
    }
    if (webPages.length) {
      node.redirect = `/plugin/@/${name}/config`
      node.children = [
        {
          path: `/plugin/@/${name}/config`,
          name: `PluginConfig_${name}`,
          component: '/guoba/plugins/plugin-detail/index',
          meta: { title: '插件配置', icon: 'ant-design:setting-outlined' },
        },
        ...webPages.map((page) => ({
          path: `/plugin/@/${name}/page/${page.id}`,
          name: `PluginPage_${name}_${page.id}`,
          component: '/guoba/plugin-page/index',
          meta: { title: page.title, icon: page.icon || 'ant-design:file-outlined', ignoreRoute: true },
          guobaMeta: { pluginPage: { plugin: name, id: page.id, component: page.entry } },
        })),
      ]
    }
    pluginMenus.push(node)
  })
  if (pluginMenus.length > 0) {
    pluginMenus.push({
      path: `/plugin/@/:name`,
      name: 'PluginDetail',
      component: `/guoba/plugins/plugin-detail/index`,
      meta: {
        title: '插件详情',
        hideMenu: true,
      },
    })
  }
  // 喵喵插件额外功能
  pluginMenus.push(...(await useMiaoPluginMenu()))

  if (pluginMenus.length > 0) {
    return [
      pluginsStoreMenu,
      {
        path: '/plugin/@',
        name: 'PluginDetailParent',
        component: '/guoba/plugins/index',
        meta: {
          title: '插件配置',
          icon: 'ant-design:tool-outlined',
        },
        // 重定向到
        redirect: pluginsIndexMenu.path,
        children: [
          // pluginsIndexMenu,
          ...pluginMenus,
        ],
      }
    ]
  } else {
    return [pluginsStoreMenu]
  }
}

const miaoMenu = {
  path: '/plugin/extra/miao-plugin',
  name: 'MiaoPlugin',
  component: '/guoba/plugins/extra-config/miao-plugin/index',
  meta: {
    title: '喵喵帮助',
    icon: 'ant-design:heart-outlined',
  },
}

const miaoV1Menu = {
  path: miaoMenu.path,
  name: miaoMenu.name,
  component: '/guoba/plugins/extra-config/miao-plugin-v1/index',
  meta: {
    ...miaoMenu.meta,
  },
}

// 喵喵帮助菜单
async function useMiaoPluginMenu() {
  // 判断是否安装了喵喵插件
  if (PluginsMap.get('miao-plugin')) {
    // 判断喵喵插件版本
    try {
      let miaoVersion = (await import('../../../../../../../miao-plugin/components/Version.js')).default
      if (miaoVersion.version.startsWith('1')) {
        return [miaoV1Menu]
      } else {
        return [miaoMenu]
      }
    } catch (e) {
      logger.error(e)
    }
  }
  return []
}
