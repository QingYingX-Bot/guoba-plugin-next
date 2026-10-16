// todo adapter
import fs from 'fs'
import path from 'path'
import loader from '../../../../../../../lib/plugins/loader.js'
import {hasGenshin, hasPlugin, isTRSS} from '#guoba.adapter'
import {_paths} from '#guoba.platform'
import {isQQBotStorageOwnedByGuoba, QQBOT_STORAGE_DEFAULTS} from '../../../../../utils/qqbotStorage.js'

const CfgAdapter = await (() => {
  if (isTRSS) {
    return import('./useTRSSConfig.js')
  } else {
    return import('./useMiaoConfig.js')
  }
})()

const addGroupPromptProps = CfgAdapter['addGroupPromptProps']

// 只有存在 db.yaml 的版本才显示数据库配置卡片
const hasDbConfig = fs.existsSync(path.join(_paths.root, '/config/config/db.yaml'))

/**
 * 服务器配置放在哪个文件里。
 *
 * TRSS-Yunzai 单独有 `server.yaml`；早期版本和 Orangezai 这类 fork 把 url / port /
 * redirect 直接写在 `bot.yaml` 里，没有 server.yaml —— 那种情况下卡片得指到 bot.yaml，
 * 不然打开「基础配置」就是一个 ENOENT。
 */
const hasServerConfig = fs.existsSync(path.join(_paths.root, '/config/config/server.yaml'))
const serverConfigFile = hasServerConfig ? '/config/config/server.yaml' : '/config/config/bot.yaml'
/** 服务器配置并进 bot.yaml 的宿主只有这几项，鉴权 / https 是 TRSS 独有的 */
const MERGED_SERVER_FIELDS = new Set(['url', 'port', 'redirect'])

/** 服务器配置卡片：并进 bot.yaml 时只留宿主真的支持的字段 */
function serverCards() {
  const cards = CfgAdapter['baseConfig'].server ?? []
  if (hasServerConfig) return cards
  return cards.map((card) => ({
    ...card,
    schemas: (card.schemas ?? []).filter((s) => MERGED_SERVER_FIELDS.has(s.field)),
  }))
}

/**
 * 数据库（Sequelize）配置，对应 config/config/db.yaml。
 * 该配置由 `new Sequelize(cfg.db)` 直接消费（见 plugins/genshin/model/db/BaseModel.js），
 * 所以字段名必须与 Sequelize 的构造参数保持一致。
 */
const databaseConfig = {
  key: 'system.db',
  title: '数据库配置',
  desc: '机器人数据存储，默认使用SQLite，修改后需重启生效',
  schemas: [
    {
      field: 'dialect',
      label: '数据库类型',
      required: true,
      bottomHelpMessage: '默认SQLite，无需额外部署。改用其他类型需自行安装对应驱动',
      component: 'Select',
      componentProps: {
        options: [
          {label: 'SQLite', value: 'sqlite'},
          {label: 'MySQL', value: 'mysql'},
          {label: 'MariaDB', value: 'mariadb'},
          {label: 'PostgreSQL', value: 'postgres'},
          {label: 'SQL Server', value: 'mssql'},
          {label: 'DB2', value: 'db2'},
        ],
        placeholder: '请选择数据库类型',
      },
    },
    {
      field: 'storage',
      label: 'SQLite文件路径',
      bottomHelpMessage: '仅SQLite使用，相对于Yunzai根目录。改动前请先备份原文件',
      component: 'Input',
      componentProps: {
        placeholder: 'data/db/data.db',
      },
    },
    {
      label: '以下仅在使用 MySQL 等外部数据库时需要填写',
      component: 'Divider',
    },
    {
      field: 'host',
      label: '数据库地址',
      component: 'Input',
      componentProps: {
        placeholder: '127.0.0.1',
      },
    },
    {
      field: 'port',
      label: '数据库端口',
      component: 'InputNumber',
      componentProps: {
        placeholder: 'MySQL默认3306，PostgreSQL默认5432',
        min: 1,
        max: 65535,
      },
    },
    {
      field: 'database',
      label: '数据库名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入数据库名',
      },
    },
    {
      field: 'username',
      label: '用户名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户名',
      },
    },
    {
      field: 'password',
      label: '密码',
      component: 'InputPassword',
      componentProps: {
        placeholder: '请输入密码',
      },
    },
    {
      field: 'logging',
      label: 'SQL日志',
      bottomHelpMessage: '开启后会把每条SQL打进日志，排查问题时再开',
      component: 'Switch',
    },
  ],
}

/**
 * QQBot 相关配置。
 *
 * 面板不搬配置：QQBot-Plugin 把配置放在宿主的 `config/QQBot.yaml`
 * （`adapter/context.js` 里 makeConfig 出来的）。这里只是把它映射成卡片，直接读写原文件。
 *
 * 显示条件：装了 QQBot-Plugin **且** 配置文件已经存在。配置文件是插件加载时创建的，
 * 没装就没这个文件；而 YamlReader 读不到文件会直接抛错，把整个配置页打成 500。
 *
 * 字段清单对齐 QQBot-Plugin 自带的 Web 控制台（`webadapter/index.js` 的
 * BOOLEAN_FIELDS / NUMBER_FIELDS），标签、说明、取值范围都跟那边保持一致。敏感键和
 * 插件自己维护的键（token / bot_openid / keyboardid / rawButton / markdown / template /
 * tips）不在这里出现，但也不会被动到 —— 保存时只写表单里有的键，其余原样留在文件里。
 *
 * 「消息存储设置」就放在这张卡片里、也写进同一个 `config/QQBot.yaml`：
 * 这几个字段（autoRecordMessage / storageBackend / saveTimes / autoDownloadImgorVideo /
 * maxMediaCacheSize）是被 QQBot-Plugin 消费的（`lib/message.js`、`lib/notice.js` 读
 * `Bot.*` 全局）。**装了 QQBot-Web-Adapter 时这几个值归它管**（它在自己的 loadConfig 里
 * 写 `Bot.*`），Guoba 就完全不显示、也不赋值，避免两套配置打架；没装它时由 Guoba
 * 读这里并赋值，详见 `utils/qqbotStorage.js`。
 */
const qqbotPluginKey = 'qqbot.plugin'
const qqbotPluginFile = '/config/QQBot.yaml'

const hasQQBotPlugin = hasPlugin('QQBot-Plugin')
  && fs.existsSync(path.join(_paths.root, qqbotPluginFile))

/** 消息存储设置由 Guoba 管（装了 QQBot-Plugin 且没装 Web-Adapter） */
const qqbotStorageByGuoba = isQQBotStorageOwnedByGuoba()

/**
 * 消息存储设置的字段。
 * 写进 `config/QQBot.yaml` 顶层 —— QQBot-Plugin 自己不看这几个键（它读的是 `Bot.*`），
 * 但它的 Web 控制台是按白名单渲染的，多出来的键不会被它捡走。
 */
const qqbotStorageSchemas = [
  {
    field: 'autoRecordMessage',
    label: '消息记录开关',
    bottomHelpMessage: '关掉后不再记录消息和新活跃群，消息记录页就没数据了',
    component: 'Switch',
  },
  {
    field: 'storageBackend',
    label: '消息存储后端',
    bottomHelpMessage: 'Redis 性能高；SQLite 不用额外服务。切换后新消息进新后端，旧数据不动',
    component: 'Select',
    componentProps: {
      options: [
        {label: 'Redis（默认）', value: 'redis'},
        {label: 'SQLite', value: 'sqlite'},
      ],
      placeholder: '请选择存储后端',
    },
  },
  {
    field: 'autoDownloadImgorVideo',
    label: '图片/视频缓存',
    bottomHelpMessage: '开启后把消息里的图片/视频下载到本地保存；关掉则用原始 URL，但很快会失效',
    component: 'Switch',
  },
  {
    field: 'maxMediaCacheSize',
    label: '缓存大小上限',
    bottomHelpMessage: '单个文件超过这个大小就不下载、直接用原始 URL',
    component: 'InputNumber',
    componentProps: {
      min: 1,
      max: 100,
      placeholder: '10',
    },
  },
  {
    field: 'saveTimes',
    label: '记录/缓存保留天数',
    bottomHelpMessage: '留得越久占的存储空间越大',
    component: 'Select',
    componentProps: {
      options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({label: `${n} 天`, value: n})),
      placeholder: '请选择保留天数',
    },
  },
]

/**
 * 消息存储设置那一段。
 * 装了 Web-Adapter 就换成一句指路，免得用户在这儿找半天。
 */
const qqbotStorageSection = qqbotStorageByGuoba
  ? [
    {label: '消息存储设置', component: 'Divider'},
    ...qqbotStorageSchemas,
    {
      label: '这几个值存在 config/QQBot.yaml 里，由 Guoba 在启动后赋给 QQBot-Plugin。改完保存即时生效，不用重启。',
      component: 'Divider',
    },
  ]
  : [
    {label: '消息存储设置', component: 'Divider'},
    {
      label: '检测到装了 QQBot-Web-Adapter：消息记录开关 / 存储后端 / 保留天数这几项由它管理（它启动时会覆盖 Bot.*），这里不显示。要改请去它自带的控制台。',
      component: 'Divider',
    },
  ]

const qqbotPluginCard = {
  key: qqbotPluginKey,
  title: 'QQBot 插件配置',
  desc: 'QQBot-Plugin(风佬)基本配置',
  schemas: [
    {label: '发送行为', component: 'Divider'},
    {
      field: 'toCallback',
      label: '全局回调按钮',
      bottomHelpMessage: '自动把发送的按钮转成回调按钮（需要原生按钮权限）',
      component: 'Switch',
    },
    {
      field: 'toQRCode',
      label: '转二维码发送',
      bottomHelpMessage: '把消息里的链接转成二维码图片再发出去',
      component: 'Switch',
    },
    {
      field: 'toBotUpload',
      label: '上传到 QQ 富媒体',
      bottomHelpMessage: '图片/视频先上传到 QQ 再发；关掉则直接发外链，链接会失效得比较快',
      component: 'Switch',
    },
    {
      field: 'hideGuildRecall',
      label: '隐藏频道撤回提示',
      bottomHelpMessage: '撤回频道消息时不发撤回提示',
      component: 'Switch',
    },
    {
      field: 'smallbtn',
      label: '全局小按钮',
      bottomHelpMessage: '全局使用小尺寸按钮样式',
      component: 'Switch',
    },
    {
      field: 'fakemsg',
      label: '野收官发',
      bottomHelpMessage: '野收官发全局开关，配合野收官发插件使用',
      component: 'Switch',
    },
    {label: '流式消息', component: 'Divider'},
    {
      field: 'stream',
      label: '流式消息',
      bottomHelpMessage: '私信全局使用流式消息（发送失败会自动回退普通发送）',
      component: 'Switch',
    },
    {
      field: 'chunkSize',
      label: '流式分块大小',
      bottomHelpMessage: '流式消息每块显示的字数',
      component: 'InputNumber',
      componentProps: {
        min: 1,
        placeholder: '2',
      },
    },
    {
      field: 'delay',
      label: '流式延迟',
      bottomHelpMessage: '流式消息每块之间的间隔',
      component: 'InputNumber',
      componentProps: {
        min: 0,
        placeholder: '100',
      },
    },
    {label: '消息过滤', component: 'Divider'},
    {
      field: 'filter_bot_msg',
      label: '过滤机器人消息',
      bottomHelpMessage: '忽略来自其他 bot 的消息',
      component: 'Switch',
    },
    {
      field: 'filter_only_at_other_bot',
      label: '过滤纯艾特其他机器人',
      bottomHelpMessage: '只艾特了其他 bot、没艾特自己的消息直接过滤',
      component: 'Switch',
    },
    {label: '其他', component: 'Divider'},
    {
      field: 'imageLength',
      label: '图片压缩阈值',
      bottomHelpMessage: '超过这个大小（MB）的图片自动压缩，填 0 表示不压缩',
      component: 'InputNumber',
      componentProps: {
        min: 0,
        placeholder: '3',
      },
    },
    {
      field: 'stat',
      label: '使用统计',
      bottomHelpMessage: '按机器人记录每日使用人数/群数、留存与增减（需重启生效）',
      component: 'Switch',
    },
    {
      field: 'permission',
      label: '命令权限',
      bottomHelpMessage: 'QQBot 各命令所需的最低权限',
      component: 'Select',
      componentProps: {
        options: [
          {label: '主人', value: 'master'},
          {label: '群主', value: 'owner'},
          {label: '管理员', value: 'admin'},
          {label: '所有人', value: 'all'},
        ],
        placeholder: '请选择命令权限',
      },
    },
    {label: '连接（以下改动需重启 Yunzai）', component: 'Divider'},
    {
      field: 'bot.newapi',
      label: '使用新 API',
      bottomHelpMessage: '走新版 api.bot.qq.com；关掉则走旧的 api.sgroup.qq.com',
      component: 'Switch',
    },
    {
      field: 'bot.sandbox',
      label: '沙箱模式',
      bottomHelpMessage: '开启 QQ 机器人沙箱环境',
      component: 'Switch',
    },
    {
      field: 'bot.timeout',
      label: '接口超时',
      bottomHelpMessage: '接口请求超时时间，默认 30000',
      component: 'InputNumber',
      componentProps: {
        min: 0,
        placeholder: '30000',
      },
    },
    ...qqbotStorageSection,
  ],
}

/** QQBot 配置单独一个 tab，排在群组配置后面；装了 QQBot-Plugin 才给卡片 */
function qqbotConfig() {
  const cards = []
  if (hasQQBotPlugin) cards.push(qqbotPluginCard)
  return {
    key: 'qqbot',
    title: 'QQBot配置',
    cards,
  }
}

/**
 * 配置读出来之后、发给前端之前的修正（由 ConfigServiceImpl.getConfigData 调用）。
 *
 * 1. QQBot 插件配置里的 `bot.maxRetry` 默认是 `Infinity`（文件里写 `.inf`），
 *    而配置接口的响应要过一遍 JSON 序列化 —— `Infinity` 会变成 `null`。面板拿着 `null`
 *    再存回去，文件里就成了 `maxRetry: null`，SDK 那边 `config.maxRetry || MAX_RETRY`
 *    会静默退回默认的 10 次重连，行为被悄悄改掉。
 *    所以读的时候直接把这个键摘掉。保存走的是 `YamlReader.setDataRecursion`，它只写
 *    「传进来的数据里有的键」，没传的键原样留在文件里，`maxRetry: .inf` 不会被碰。
 *
 * 2. 消息存储设置由 Guoba 管时，`config/QQBot.yaml` 里还没写过的键用默认值补上。
 *    不补的话面板上那几个开关会渲染成空/关，用户一保存就把默认值（比如
 *    `autoRecordMessage: true`）写成 `false`，等于误关掉消息记录。
 */
export function normalizeConfigData(action, key, data) {
  if (action !== 'get' || key !== qqbotPluginKey) return data
  if (!data || Array.isArray(data)) return data

  let result = data

  if (result.bot && typeof result.bot === 'object' && 'maxRetry' in result.bot) {
    const {maxRetry, ...bot} = result.bot
    result = {...result, bot}
  }

  if (qqbotStorageByGuoba) {
    const filled = {...result}
    let changed = false
    for (const [field, def] of Object.entries(QQBOT_STORAGE_DEFAULTS)) {
      if (filled[field] === undefined || filled[field] === null) {
        filled[field] = def
        changed = true
      }
    }
    if (changed) {
      result = filled
    }
  }

  return result
}

// 基础配置
const baseConfig = {
  key: 'base',
  title: '基础配置',
  cards: [
    {
      key: 'system.bot',
      title: '机器人配置',
      desc: '对机器人进行相关配置',
      schemas: [
        {
          field: 'log_level',
          label: '日志等级',
          bottomHelpMessage: '日志输出等级。Mark时只显示执行命令，不显示聊天记录',
          component: 'Select',
          componentProps: {
            options: [
              {label: 'Trace', value: 'trace'},
              {label: 'Debug', value: 'debug'},
              {label: 'Info', value: 'info'},
              {label: 'Warn', value: 'warn'},
              {label: 'Fatal', value: 'fatal'},
              {label: 'Mark', value: 'mark'},
              {label: 'Error', value: 'error'},
              {label: 'Off', value: 'off'},
            ],
            placeholder: '请选择日志等级',
          },
        },
        ...(CfgAdapter['baseConfig'].bot ?? []),
        {
          field: 'online_msg_exp',
          label: '推送帮助冷却',
          bottomHelpMessage: '填上线推送通知的冷却时间',
          component: 'InputNumber',
          componentProps: {
            placeholder: '（分钟）',
          },
        },
        {
          field: 'chromium_path',
          label: 'chromium路径',
          bottomHelpMessage: 'chromium其他路径，默认无需填写，需要时可填写chromium的可执行文件绝对路径',
          component: 'Input',
          componentProps: {
            placeholder: '请输入chromium路径',
          },
        },
        {
          field: 'puppeteer_ws',
          label: 'puppeteer接口地址',
          bottomHelpMessage: 'puppeteer接口地址，默认无需填写',
          component: 'Input',
          componentProps: {
            placeholder: '请输入puppeteer接口地址',
          },
        },
        {
          field: 'puppeteer_timeout',
          label: 'puppeteer截图超时时间',
          bottomHelpMessage: 'puppeteer截图超时时间，默认无需填写',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            placeholder: '（毫秒）',
          },
        },
        {
          field: 'proxyAddress',
          label: '代理地址',
          bottomHelpMessage: '米游社接口代理地址，国际服用',
          component: 'Input',
          componentProps: {
            placeholder: '请输入米游社代理地址',
          },
        },
      ],

    },
    ...serverCards(),
    {
      key: 'system.redis',
      title: 'Redis配置',
      desc: '对Redis服务器进行相关配置',
      schemas: [
        {
          field: 'host',
          label: 'Redis地址',
          required: true,
          component: 'Input',
          componentProps: {
            placeholder: '请输入Redis地址',
          },
        },
        {
          field: 'port',
          label: 'Redis端口',
          required: true,
          component: 'InputNumber',
          componentProps: {
            placeholder: '请输入Redis端口',
            min: 1,
            max: 65535,
          },
        },
        {
          field: 'username',
          label: 'Redis用户名',
          bottomHelpMessage: '没有用户名可以为空',
          component: 'Input',
          componentProps: {
            placeholder: '请输入Redis用户名',
          },
        },
        {
          field: 'password',
          label: 'Redis密码',
          bottomHelpMessage: '没有密码可以为空',
          component: 'InputPassword',
          componentProps: {
            placeholder: '请输入Redis密码',
          },
        },
        {
          field: 'db',
          label: 'Redis数据库',
          required: true,
          bottomHelpMessage: '一般不用改',
          component: 'InputNumber',
          componentProps: {
            placeholder: '请输入Redis数据库',
            min: 0,
            max: 15,
          },
        },
        {
          field: 'path',
          label: 'Redis命令路径',
          bottomHelpMessage: '本机未启动Redis时，Yunzai会用它拉起redis-server。已用外部Redis可留空',
          component: 'Input',
          componentProps: {
            placeholder: 'redis-server',
          },
        },
      ],
    },
    ...(hasDbConfig ? [databaseConfig] : []),
  ],
}

const groupConfig = () => {
  const funOptions = []
  for (let item of loader.priority) {
    if (item.hasOwnProperty('name') && item.name) {
      if (!funOptions.find(i => i.value === item.name)) {
        funOptions.push({value: item.name})
      }
    }
  }
  const funComponent = funOptions.length === 0 ? 'GTags' : 'Select'
  return {
    key: 'group',
    title: '群组配置',
    cards: [
      {
        key: 'system.group',
        type: 'keyFormCard',
        // 标题表达式
        title: `{{ form.key === 'default' ? '默认配置' : '群：' + (form?.values?.__GROUP_TIP_TEXT__ ?? form.key) }}`,
        desc: '默认配置对所有群聊生效',
        // 允许添加新的配置
        allowAdd: true,
        allowDel: true,
        // 新增按钮文本（默认“新增”）
        addBtnText: '新增群配置',
        promptProps: addGroupPromptProps,
        schemas: [
          ...(CfgAdapter['groupConfig'].group ?? []),
          {
            field: 'addPrivate',
            label: '私聊添加',
            component: 'Switch',
            bottomHelpMessage: '是否允许私聊添加',
            componentProps: {
              checkedValue: 1,
              unCheckedValue: 0,
            },
          },
          {
            field: 'enable',
            label: '功能白名单',
            component: funComponent,
            bottomHelpMessage: '配置后只有配置的功能才可以使用',
            componentProps: {
              allowAdd: true,
              allowDel: true,
              mode: 'multiple',
              options: funOptions,
            },
          },
          {
            field: 'disable',
            label: '功能黑名单',
            component: funComponent,
            bottomHelpMessage: '配置后配置的功能将不可以使用',
            componentProps: {
              allowAdd: true,
              allowDel: true,
              mode: 'multiple',
              options: funOptions,
            },
          },
        ],
      },
    ],
  }
}

const genshinConfig = {
  key: 'genshin',
  title: '原神配置',
  cards: [
    {
      key: 'genshin.mys.set',
      title: '米游社设置',
      desc: '',
      schemas: [
        {
          field: 'allowUseCookie',
          label: '使用用户ck',
          component: 'Switch',
          bottomHelpMessage: '公共查询是否使用用户ck',
          componentProps: {
            checkedValue: 1,
            unCheckedValue: 0,
          },
        },
        {
          field: 'cookieDoc',
          label: 'ck文档地址',
          component: 'Input',
          bottomHelpMessage: '默认cookie帮助文档链接地址',
          componentProps: {},
        },
        {
          field: 'isAutoSign',
          label: '开启自动签到',
          component: 'Switch',
          bottomHelpMessage: '是否开启米游社原神自动签到',
          componentProps: {
            checkedValue: 1,
            unCheckedValue: 0,
          },
        },
        {
          field: 'signTime',
          label: '签到定时任务',
          component: 'EasyCron',
          bottomHelpMessage: '米游社原神签到定时任务，Cron表达式，默认00:02开始执行，每10s签到一个',
          componentProps: {
            placeholder: '请输入或选择Cron表达式',
          },
        },
        {
          field: 'abbrSetAuth',
          label: '别名权限',
          component: 'RadioGroup',
          bottomHelpMessage: '别名设置权限',
          componentProps: {
            options: [
              {label: '所有群员都可以添加', value: 0},
              {label: '群主和管理员才能添加', value: 1},
              {label: '只有主人才能添加', value: 2},
            ],
          },
        },
      ],
    },
    {
      key: 'genshin.mys.pubCk',
      title: '公共Cookie',
      desc: '米游社公共查询cookie，允许添加多个',
      // 数组form
      type: 'arrayFormCard',
      allowAdd: true,
      allowDel: true,
      addBtnText: '添加Cookie',
      lengthMin: 1,
      schemas: [],
    },
    {
      key: 'genshin.gacha',
      title: `十连配置（{{form.key === 'default' ? '默认' : form.key}}）`,
      desc: '十连次数、概率等相关配置',
      type: 'keyFormCard',
      allowAdd: true,
      allowDel: true,
      addBtnText: '新增群单独配置',
      promptProps: addGroupPromptProps,
      schemas: [
        {
          field: 'count',
          label: '每日抽卡数',
          bottomHelpMessage: '设置每天可以抽多少次',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            placeholder: '请输入每日抽卡数',
          },
        },
        {
          field: 'delMsg',
          label: '自动撤回',
          bottomHelpMessage: '自动撤回未出货的抽卡消息，0-120 秒，0 = 不撤回',
          component: 'InputNumber',
          componentProps: {
            placeholder: '请输入自动撤回时间',
          },
        },
        {
          field: 'LimitSeparate',
          label: '分开计算',
          bottomHelpMessage: '角色池、武器池限制次数是否分开计算',
          component: 'Switch',
          componentProps: {
            checkedValue: 1,
            unCheckedValue: 0,
          },
        },
      ],
    },
  ],
}

const otherConfig = {
  key: 'other',
  title: '其他',
  cards: [
    {
      key: 'system.other',
      title: '其他配置',
      desc: '其他配置',
      schemas: [
        ...(CfgAdapter['otherConfig'].other ?? []),
        {
          field: 'blackGroup',
          label: '黑名单群',
          bottomHelpMessage: '黑名单群，可以设置多个',
          component: 'GSelectGroup',
          componentProps: {
            placeholder: '请选择黑名单群',
          },
        },
        {
          field: 'whiteGroup',
          label: '白名单群',
          bottomHelpMessage: '白名单群，可以设置多个',
          component: 'GSelectGroup',
          componentProps: {
            placeholder: '请选择白名单群',
          },
        },
        {
          field: 'autoFriend',
          label: '添加好友',
          bottomHelpMessage: '是否自动同意添加好友请求',
          component: 'Switch',
          componentProps: {
            checkedValue: 1,
            unCheckedValue: 0,
          },
        },
        {
          field: 'autoQuit',
          label: '退群人数',
          bottomHelpMessage: '被好友拉进群时，群人数小于配置值自动退出，设为0表示不处理',
          component: 'InputNumber',
          componentProps: {
            placeholder: '请输入退群人数',
            min: 0,
          },
        },
        {
          field: 'disablePrivate',
          label: '禁用私聊',
          bottomHelpMessage: '禁用后私聊只接受ck以及抽卡链接（Bot主人不受限制）',
          component: 'Switch',
        },
        {
          field: 'disableMsg',
          label: '禁私聊提示',
          bottomHelpMessage: '禁用私聊时Bot的提示内容',
          component: 'Input',
          componentProps: {
            placeholder: '请输入禁用提示',
          },
        },
        {
          field: 'disableAdopt',
          label: '私聊通行字符串',
          bottomHelpMessage: '禁用私聊后，允许响应的字符串',
          component: 'GTags',
          componentProps: {
            allowAdd: true,
            allowDel: true,
          },
        },
      ],
    },
  ],
}

export function getConfigTabs() {
  let tabs = []
  tabs.push(baseConfig)
  tabs.push(groupConfig())
  // QQBot 配置排在群组配置后面；两个插件的卡片一个都出不来时整个 tab 藏掉
  const qqbot = qqbotConfig()
  if (qqbot.cards.length) {
    tabs.push(qqbot)
  }
  if (hasGenshin) {
    tabs.push(genshinConfig)
  }
  tabs.push(otherConfig)
  return tabs
}

export const configFile = {
  'system.bot': '/config/config/bot.yaml',
  'system.qq': '/config/config/qq.yaml',
  'system.group': '/config/config/group.yaml',
  'system.redis': '/config/config/redis.yaml',
  'system.other': '/config/config/other.yaml',
  'system.server': serverConfigFile,
  'system.db': '/config/config/db.yaml',

  // QQBot 插件的配置文件，卡片只在装了 QQBot-Plugin 时才会出现
  [qqbotPluginKey]: qqbotPluginFile,

  'genshin.gacha': '/plugins/genshin/config/gacha.set.yaml',
  'genshin.mys.pubCk': '/plugins/genshin/config/mys.pubCk.yaml',
  'genshin.mys.set': '/plugins/genshin/config/mys.set.yaml',
  'genshin.role.name': '/plugins/genshin/config/role.name.yaml',
}
