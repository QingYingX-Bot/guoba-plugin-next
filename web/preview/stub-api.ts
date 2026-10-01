import type { MiaoHelpCfgBody, MiaoHelpGroup, MiaoThemeItem } from '@/types'

const helpCfg: MiaoHelpCfgBody = {
  title: '使用帮助',
  subTitle: 'Yunzai-Bot & Miao-Plugin',
  colCount: 3,
  colWidth: 265,
  theme: 'all',
  themeExclude: ['default'],
  bgBlur: true,
}

const helpList: MiaoHelpGroup[] = [
  {
    group: '面板相关',
    list: [
      { icon: 1, title: '#喵喵帮助', desc: '查看本帮助图' },
      { icon: 2, title: '#喵喵设置', desc: '查看与修改配置' },
      { icon: 3, title: '#喵喵更新', desc: '更新喵喵插件' },
      { icon: 4, title: '#喵喵版本', desc: '查看当前版本' },
      { icon: 5, title: '#喵喵日志', desc: '查看最近日志' },
    ],
  },
  {
    group: '角色面板',
    list: [
      { icon: 11, title: '#刻晴面板', desc: '查看角色详细面板' },
      { icon: 12, title: '#刻晴面板更新', desc: '强制刷新面板数据' },
      { icon: 13, title: '#面板统计', desc: '统计群内角色数据' },
      { icon: 14, title: '#雷神伤害', desc: '计算期望伤害' },
      { icon: 15, title: '#胡桃圣遗物', desc: '查看圣遗物评分' },
      { icon: 16, title: '#胡桃词条', desc: '查看有效词条数' },
    ],
  },
  {
    group: '抽卡分析',
    list: [
      { icon: 21, title: '#抽卡分析', desc: '获取抽卡链接' },
      { icon: 22, title: '#十连', desc: '模拟一次十连' },
      { icon: 23, title: '#角色统计', desc: '统计角色出货情况' },
      { icon: 24, title: '#武器统计', desc: '统计武器出货情况' },
      { icon: 25, title: '#原石统计', desc: '统计原石消耗' },
    ],
  },
  {
    group: '养成计算',
    list: [
      { icon: 31, title: '#养成计算', desc: '计算角色升级材料' },
      { icon: 32, title: '#武器养成', desc: '计算武器升级材料' },
      { icon: 33, title: '#天赋计算', desc: '计算天赋书需求' },
      { icon: 34, title: '#材料查询', desc: '查询材料掉落来源' },
    ],
  },
]

const themes: MiaoThemeItem[] = [
  {
    name: 'test',
    style: {
      fontColor: '#ffa600',
      descColor: '#ff0000',
      contBgColor: '#ff0000',
      headerBgColor: '#ff0000',
      rowBgColor1: '#ff0000',
      rowBgColor2: '#ff1f1f',
    },
  },
  {
    name: 'default',
    style: {
      fontColor: '#ceb78b',
      descColor: '#eee',
      contBgColor: 'rgba(6, 21, 31, .5)',
      headerBgColor: 'rgba(6, 21, 31, .4)',
      rowBgColor1: 'rgba(6, 21, 31, .2)',
      rowBgColor2: 'rgba(6, 21, 31, .35)',
    },
  },
]

const IMG = './img'

export const apiGetMiaoHelpCfg = async () => ({
  helpCfg: structuredClone(helpCfg),
  helpList: structuredClone(helpList),
  themeNames: themes.map((t) => t.name),
  miaoVersion: '3.1.4',
  yunzaiVersion: 'v3.1.2',
})

export const apiSaveMiaoHelpCfg = async () => ({ ok: true })
export const apiPreviewMiaoHelp = async () => ({ image: `${IMG}/preview.png` })

export const apiGetMiaoThemeList = async () => structuredClone(themes)
export const apiGetMiaoThemeConfig = async (themeName: string) =>
  structuredClone(themes.find((t) => t.name === themeName)?.style ?? {})

export const apiSaveMiaoThemeConfig = async (themeName: string, config: any) => {
  const target = themes.find((t) => t.name === themeName)
  if (target) target.style = { ...config }
  return { ok: true }
}
export const apiAddMiaoTheme = async () => ({ ok: true })
export const apiPutMiaoTheme = async () => ({ ok: true })
export const apiDeleteMiaoTheme = async () => ({ ok: true })

export const apiGetMiaoBackupList = async () => [
  { id: 'b1', remark: '改配色前', time: '2026-10-01 22:10:00', version: 2, isInit: false },
  { id: 'b2', remark: '初始备份', time: '2026-09-20 09:00:00', version: 2, isInit: true },
]
export const apiAddMiaoBackup = async () => ({ ok: true })
export const apiRestoreMiaoBackup = async () => ({ ok: true })
export const apiDeleteMiaoBackup = async () => ({ ok: true })

export function miaoThemeMainUrl(themeName: string, _token: string, ts?: number) {
  return `${IMG}/main.png${ts ? `?_t=${ts}` : ''}`
}

export function miaoThemeBgUrl(_themeName: string, _token: string, ts?: number) {
  return `${IMG}/bg.jpg${ts ? `?_t=${ts}` : ''}`
}

export function miaoHelpIconUrl(_token: string, ts?: number) {
  return `${IMG}/icon.png${ts ? `?_t=${ts}` : ''}`
}
