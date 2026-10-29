<script setup lang="ts">
/**
 * Redis 浏览器。
 *
 * key 列表用 SCAN 游标翻页（后端同样走 SCAN，不用 KEYS，
 * 避免 key 多时阻塞 Redis）。所以只有「加载数据」一次拉到底，没有跳页。
 */
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Empty,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  SelectOption,
  Spin,
  Table,
  Tag,
  Textarea,
  Tree,
  message,
} from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import {
  apiRedisCommand,
  apiRedisDel,
  apiRedisGet,
  apiRedisInfo,
  apiRedisNamespaces,
  apiRedisScan,
  apiRedisSet,
  type RedisInfo,
  type RedisKeyItem,
  type RedisKeyType,
  type RedisNamespace,
  type RedisValue,
} from '@/api'

const info = ref<RedisInfo | null>(null)
const items = ref<RedisKeyItem[]>([])
/** 「加载数据」在跑，按钮上要转圈并报进度 */
const loadingAll = ref(false)
/** SCAN 游标，0 表示已经扫完一轮 */
const cursor = ref(0)
const scanned = ref(false)
const selectedKeys = ref<string[]>([])
/**
 * 这次列表没加载哪些「顶层」。
 */
const excludeTops = ref<string[]>([])

/** 「加载数据」的顶层勾选框 */
const nsOpen = ref(false)
const nsLoading = ref(false)
const nsList = ref<RedisNamespace[]>([])
const nsChecked = ref<string[]>([])

/**
 * 搜索框里那段文字 —— 只对本地已加载的这份列表做筛选，一个请求都不发。
 *
 * 输入子串（比如 user）就按子串匹配，带 * / ? 就按 glob 匹配；
 * 要重新拉数据走「刷新」，跟这个框无关。
 */
const filterText = ref('')
/** 最后一次把列表拉回来的时间 */
const lastRefreshAt = ref<number | null>(null)
/** 这一份列表是不是「加载数据」拉出来的 —— 列表太大没缓存下来时，回来要按它重拉 */
const allMode = ref(false)

/** 「加载数据」每轮多要点，少跑几趟 */
const ALL_PAGE_COUNT = 1000
/** 「加载数据」最多翻多少轮，防数据集一直变动导致循环停不下来 */
const MAX_ALL_ROUNDS = 200

const detail = ref<RedisValue | null>(null)
const detailLoading = ref(false)

/** 编辑弹窗 */
const editOpen = ref(false)
const editKey = ref('')
const editType = ref('string')
const editValue = ref('')
/** 0 表示永不过期，避免 InputNumber 的 null 类型冲突 */
const editTtl = ref(0)
const editSaving = ref(false)
/** 新建还是改已有的，影响 key 输入框能不能改 */
const editIsNew = ref(false)

/** 命令行 */
const cmdOpen = ref(false)
const cmdText = ref('')
const cmdReply = ref('')
const cmdRunning = ref(false)

const hasMore = computed(() => cursor.value !== 0)

/** 列表是不是已经「全都在这儿了」：扫到底了（没有下一页）而且确实有东西 */
const fullyLoaded = computed(() => scanned.value && !hasMore.value && items.value.length > 0)

/** 本地筛选：带 * 或 ? 就按 glob 匹配，否则当子串（都不区分大小写） */
function localMatch(key: string, pattern: string) {
  const p = pattern.trim()
  if (!p || p === '*') return true
  if (!/[*?]/.test(p)) return key.toLowerCase().includes(p.toLowerCase())
  const re = new RegExp(
    '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i',
  )
  return re.test(key)
}

/** 实际显示出来的 key：搜索框里那段文字只筛本地这份列表，一个请求都不发 */
const shownItems = computed(() => {
  const q = filterText.value
  if (!q.trim() || q.trim() === '*') return items.value
  return items.value.filter((it) => localMatch(it.key, q))
})

/** 本地筛选命中的条数；没在筛选时是 0（模板据此决定要不要显示这一段） */
const filteredCount = computed(() =>
  filterText.value.trim() ? shownItems.value.length : 0,
)

/** 列表空的时候显示 */
const emptyText = computed(() => {
  if (!scanned.value) return '还没加载数据，点下方「加载数据」开始'
  if (filterText.value.trim()) return '本地筛选没有匹配的 key'
  return '没有匹配的 key'
})

/** 最后一次刷新的时间 */
const refreshText = computed(() => {
  const ts = lastRefreshAt.value
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
})

/** hash 的示例含换行和引号，写在模板里会被当成表达式解析，放这里 */
const editPlaceholder = computed(() =>
  editType.value === 'hash' ? '{\n  "field": "value"\n}' : '值内容',
)

const columns = [
  { title: 'Key', dataIndex: 'key', key: 'key', ellipsis: true },
  { title: '类型', dataIndex: 'type', key: 'type', width: 90 },
  { title: 'TTL', dataIndex: 'ttl', key: 'ttl', width: 110 },
  { title: '', key: 'action', width: 70 },
]

/* ---------------- 目录树视图 ---------------- */

type ViewMode = 'list' | 'tree'

interface RedisTreeNode {
  title: string
  key: string
  children?: RedisTreeNode[]
  redisKey?: string
  type?: RedisKeyType
  ttl?: number
}

const VIEW_KEY = 'guoba-redis-view'

const viewMode = ref<ViewMode>(localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'list')
const expandedKeys = ref<string[]>([])
const winHeight = ref(window.innerHeight)

function setViewMode(mode: ViewMode) {
  viewMode.value = mode
  localStorage.setItem(VIEW_KEY, mode)
}

const VIEW_OPTIONS = [
  {
    value: 'list',
    label: () => h('span', { class: 'g-view-label' }, [
      h(GIcon, { icon: 'ant-design:unordered-list-outlined', size: 14 }),
      h('span', { class: 'g-view-text' }, '列表'),
    ]),
  },
  {
    value: 'tree',
    label: () => h('span', { class: 'g-view-label' }, [
      h(GIcon, { icon: 'ant-design:folder-outlined', size: 14 }),
      h('span', { class: 'g-view-text' }, '目录树'),
    ]),
  },
]

/**
 * 目录树里一行的高度。
 */
const TREE_ROW_H = 28
/** 目录树最高占多高，超过就自己滚 */
const treeMaxHeight = computed(() => Math.max(240, winHeight.value - 305))
/**
 * 目录树的高度按「实际会显示几个节点」算。
 */
const treeVisibleCount = computed(() => {
  let n = 0
  const walk = (nodes: RedisTreeNode[]) => {
    for (const node of nodes) {
      n++
      if (node.children?.length && expandedKeys.value.includes(node.key)) walk(node.children)
    }
  }
  walk(treeData.value)
  return n
})
const treeHeight = computed(() =>
  Math.min(treeMaxHeight.value, Math.max(TREE_ROW_H, treeVisibleCount.value * TREE_ROW_H)),
)

const treeSelectedKeys = computed(() => (detail.value ? [detail.value.key] : []))

/** 已加载的 key 按 `:` 拆成分层结构 */
const treeData = computed<RedisTreeNode[]>(() => {
  const byPath = new Map<string, RedisTreeNode>()
  const roots: RedisTreeNode[] = []
  for (const item of shownItems.value) {
    const parts = item.key.split(':')
    let path = ''
    let node: RedisTreeNode | undefined
    let parent: RedisTreeNode | undefined
    for (let i = 0; i < parts.length; i++) {
      path = i === 0 ? parts[i] : `${path}:${parts[i]}`
      node = byPath.get(path)
      if (!node) {
        node = { title: parts[i], key: path, children: [] }
        byPath.set(path, node)
        if (parent) parent.children!.push(node)
        else roots.push(node)
      }
      parent = node
    }
    if (node) {
      node.redisKey = item.key
      node.type = item.type
      node.ttl = item.ttl
    }
  }
  sortTree(roots)
  return roots
})

function sortTree(nodes: RedisTreeNode[]) {
  nodes.sort((a, b) => {
    const dir = (a.children?.length ? 0 : 1) - (b.children?.length ? 0 : 1)
    return dir || a.title.localeCompare(b.title)
  })
  nodes.forEach((n) => {
    if (n.children?.length) sortTree(n.children)
  })
}

function expandAllTree() {
  const keys: string[] = []
  const walk = (nodes: RedisTreeNode[]) => {
    nodes.forEach((n) => {
      if (n.children?.length) {
        keys.push(n.key)
        walk(n.children)
      }
    })
  }
  walk(treeData.value)
  expandedKeys.value = keys
}

function onTreeSelect(_keys: any, info: any) {
  const node = info.node as RedisTreeNode
  if (node.redisKey) openDetail(node.redisKey)
}

function syncWinHeight() {
  winHeight.value = window.innerHeight
}

function ttlText(ttl: number) {
  if (ttl === -1) return '永不过期'
  if (ttl < 0) return '-'
  if (ttl < 60) return `${ttl} 秒`
  if (ttl < 3600) return `${Math.floor(ttl / 60)} 分钟`
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} 小时`
  return `${Math.floor(ttl / 86400)} 天`
}

const TYPE_COLOR: Record<string, string> = {
  string: 'blue',
  hash: 'purple',
  list: 'cyan',
  set: 'green',
  zset: 'orange',
}

async function loadInfo() {
  try {
    info.value = await apiRedisInfo()
  } catch {
    // 概览拿不到不影响浏览，静默即可
  }
}

/** 拉一页。模式固定 `*`：搜索只在本地做，不再往服务端打 glob */
function fetchKeys(from: number, count: number) {
  return apiRedisScan({
    cursor: from,
    match: '*',
    count,
    exclude: excludeTops.value.join(','),
  })
}

/**
 * 把新扫到的 key 追加进列表。
 */
function appendKeys(list: RedisKeyItem[], seen: Set<string>) {
  for (const item of list) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    items.value.push(item)
  }
}

/** 目录树默认只展开第一层，全展开太卡 */
function expandTopLevel() {
  expandedKeys.value = treeData.value
    .filter((n) => n.children?.length)
    .map((n) => n.key)
}

/**
 * 从游标 0 一直扫。
 *
 * @param target 攒够这么多条就收手；0 表示扫到底
 */
async function scanAll(target: number) {
  cursor.value = 0
  items.value = []
  selectedKeys.value = []
  const seen = new Set<string>()
  let next = 0
  let rounds = 0
  while (true) {
    const data = await fetchKeys(next, ALL_PAGE_COUNT)
    appendKeys(data.items, seen)
    next = data.cursor
    rounds++
    if (next === 0 || (target > 0 && items.value.length >= target) || rounds >= MAX_ALL_ROUNDS) break
  }
  cursor.value = next
  scanned.value = true
  lastRefreshAt.value = Date.now()
  expandTopLevel()
}

/** 真正开扫。 */
async function loadAll(exclude: string[]) {
  excludeTops.value = exclude
  allMode.value = true
  filterText.value = ''
  loadingAll.value = true
  try {
    await scanAll(0)
  } finally {
    loadingAll.value = false
    saveCache()
  }
}

/**
 * 打开顶层勾选框。
 *
 * 统计只回聚合结果，key 本体一个不带回来，所以这一步很快。
 *
 * @param prefillCurrent true = 回显「这份列表实际加载了哪些顶层」（「设置」用）；
 *                       false = 走默认，消息记录不勾（「加载数据」用）
 */
async function openNamespaceModal(prefillCurrent: boolean) {
  nsOpen.value = true
  nsLoading.value = true
  nsList.value = []
  try {
    const list = await apiRedisNamespaces('*')
    nsList.value = list
    const excluded = new Set(excludeTops.value)
    nsChecked.value = prefillCurrent
      ? list.filter((n) => !excluded.has(n.name)).map((n) => n.name)
      : list.filter((n) => !n.message).map((n) => n.name)
  } catch {
    nsOpen.value = false
  } finally {
    nsLoading.value = false
  }
}

/** 点「加载数据」：先统计一遍顶层，弹勾选框 */
function onLoadAll() {
  return openNamespaceModal(false)
}

/** 点「设置」：同一个勾选框，只是把当前的选择回显出来，改完点「加载」生效 */
function onSettings() {
  return openNamespaceModal(true)
}

/** 点二次确认 */
function onRefresh() {
  Modal.confirm({
    title: '确认刷新？',
    content: `会按当前选择重新扫一遍，覆盖现在的 ${items.value.length} 条数据。`,
    okText: '刷新',
    cancelText: '取消',
    onOk: () => loadAll(excludeTops.value),
  })
}

/** 勾选框里的「全选 / 全不选」 */
function setAllNs(all: boolean) {
  nsChecked.value = all ? nsList.value.map((n) => n.name) : []
}

/** 二次确认 */
function confirmLoadAll() {
  if (!nsChecked.value.length) {
    message.warning('至少勾一个顶层')
    return
  }
  const picked = nsList.value.filter((n) => nsChecked.value.includes(n.name))
  const pickedKeys = picked.reduce((sum, n) => sum + n.count, 0)
  const skipped = nsList.value.filter((n) => !nsChecked.value.includes(n.name))
  const skippedKeys = skipped.reduce((sum, n) => sum + n.count, 0)
  Modal.confirm({
    title: '确认加载？',
    content: skipped.length
      ? `加载 ${picked.length} 个顶层、约 ${pickedKeys} 个 key；跳过 ${skipped.length} 个顶层（约 ${skippedKeys} 个 key）：${skipped.map((n) => n.name).join('、')}。`
      : `加载全部 ${picked.length} 个顶层、约 ${pickedKeys} 个 key。`,
    okText: '加载',
    cancelText: '再选选',
    onOk: () => {
      nsOpen.value = false
      return loadAll(nsList.value.filter((n) => !nsChecked.value.includes(n.name)).map((n) => n.name))
    },
  })
}

/**
 * 悄悄把列表按原来的深度重扫一遍（执行命令之后对齐用，不弹确认）。
 */
async function refresh() {
  const target = items.value.length
  if (target === 0) return
  try {
    await scanAll(target)
  } finally {
    saveCache()
  }
}

/** 保存后把列表里那行就地更新 */
function upsertKey(key: string, type: RedisKeyType, ttl: number) {
  const item: RedisKeyItem = { key, type, ttl }
  const idx = items.value.findIndex((i) => i.key === key)
  if (idx >= 0) items.value[idx] = item
  else items.value.unshift(item)
}

async function openDetail(key: string) {
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await apiRedisGet(key)
  } catch {
    // 错误提示由请求层统一弹出
  } finally {
    detailLoading.value = false
  }
}

/** 详情里的值转成适合展示的文本 */
const detailText = computed(() => {
  const d = detail.value
  if (!d) return ''
  if (d.type === 'string') {
    // 存的是 JSON 就格式化一下，Yunzai 里大量 key 是 JSON 字符串
    try {
      return JSON.stringify(JSON.parse(d.value), null, 2)
    } catch {
      return String(d.value ?? '')
    }
  }
  return JSON.stringify(d.value, null, 2)
})

function openCreate() {
  editIsNew.value = true
  editKey.value = ''
  editType.value = 'string'
  editValue.value = ''
  editTtl.value = 0
  editOpen.value = true
}

function openEdit(d: RedisValue) {
  if (d.type !== 'string' && d.type !== 'hash') {
    message.warning(`${d.type} 类型请用「执行命令」修改`)
    return
  }
  editIsNew.value = false
  editKey.value = d.key
  editType.value = d.type
  editValue.value = d.type === 'string'
    ? String(d.value ?? '')
    : JSON.stringify(d.value, null, 2)
  editTtl.value = d.ttl > 0 ? d.ttl : 0
  editOpen.value = true
}

async function saveEdit() {
  if (!editKey.value.trim()) {
    message.warning('key 不能为空')
    return
  }
  let value: any = editValue.value
  if (editType.value === 'hash') {
    try {
      value = JSON.parse(editValue.value)
    } catch {
      message.error('hash 的值必须是合法 JSON 对象')
      return
    }
  }
  editSaving.value = true
  try {
    const saved = await apiRedisSet({
      key: editKey.value.trim(),
      type: editType.value,
      value,
      ttl: editTtl.value,
    })
    editOpen.value = false
    detail.value = saved
    upsertKey(saved.key, saved.type, saved.ttl)
    saveCache()
    await loadInfo()
  } catch {
    // 请求层已提示
  } finally {
    editSaving.value = false
  }
}

function confirmDel(keys: string[]) {
  if (keys.length === 0) return
  Modal.confirm({
    title: `确认删除 ${keys.length} 个 key？`,
    content: keys.length === 1
      ? keys[0]
      : `包含 ${keys.slice(0, 3).join('、')}${keys.length > 3 ? ' 等' : ''}。删除后无法恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await apiRedisDel(keys)
      const removed = new Set(keys)
      if (detail.value && removed.has(detail.value.key)) {
        detail.value = null
      }
      items.value = items.value.filter((i) => !removed.has(i.key))
      selectedKeys.value = selectedKeys.value.filter((k) => !removed.has(k))
      saveCache()
      await loadInfo()
    },
  })
}

async function runCommand() {
  if (!cmdText.value.trim()) return
  cmdRunning.value = true
  try {
    const res = await apiRedisCommand(cmdText.value.trim())
    cmdReply.value = typeof res.reply === 'string'
      ? res.reply
      : JSON.stringify(res.reply, null, 2)
    // 写命令可能改了数据，刷新列表
    await Promise.all([refresh(), loadInfo()])
  } catch (e: any) {
    cmdReply.value = `错误：${e?.message ?? e}`
  } finally {
    cmdRunning.value = false
  }
}

/* ---------------- 缓存 ---------------- */

/**
 * 把列表整个存进 sessionStorage。
 */
const CACHE_KEY = 'guoba-redis-cache'
/** 条目上限。超了只存「怎么重新拉」的配方，回来重拉一遍（sessionStorage 一般就 5MB） */
const CACHE_MAX_ITEMS = 4000

interface RedisCache {
  v: 1
  excludeTops: string[]
  cursor: number
  scanned: boolean
  allMode: boolean
  lastRefreshAt: number | null
  items: RedisKeyItem[] | null
}

function saveCache() {
  if (!scanned.value) return
  const base: Omit<RedisCache, 'items'> = {
    v: 1,
    excludeTops: excludeTops.value,
    cursor: cursor.value,
    scanned: scanned.value,
    allMode: allMode.value,
    lastRefreshAt: lastRefreshAt.value,
  }
  const full: RedisCache = {
    ...base,
    items: items.value.length <= CACHE_MAX_ITEMS ? items.value : null,
  }
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(full))
  } catch {
    // 配额不够（列表太大）就退成只存配方
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...base, items: null }))
    } catch {
      // 彻底存不下就算了，不影响使用
    }
  }
}

/**
 * 从缓存恢复。
 *
 * @returns 'full'   列表和游标都回来了，不用发请求；
 *          'recipe' 只回来了「怎么重新拉」，调用方要重拉一遍；
 *          'none'   没有可用缓存
 */
function restoreCache(): 'full' | 'recipe' | 'none' {
  let c: RedisCache
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return 'none'
    c = JSON.parse(raw) as RedisCache
  } catch {
    return 'none'
  }
  if (!c || c.v !== 1 || !c.scanned) return 'none'

  excludeTops.value = Array.isArray(c.excludeTops) ? c.excludeTops : []
  cursor.value = Number(c.cursor) || 0
  allMode.value = !!c.allMode
  lastRefreshAt.value = typeof c.lastRefreshAt === 'number' ? c.lastRefreshAt : null

  if (Array.isArray(c.items) && c.items.length) {
    items.value = c.items
    scanned.value = true
    expandTopLevel()
    return 'full'
  }
  // 只恢复了配方：列表留空、scanned 保持 false，让调用方干净地重拉一遍
  return 'recipe'
}

/** 把本地这份缓存和当前列表一起丢掉，回到「什么都还没加载」的状态（服务端数据不动） */
function clearCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
  }
  items.value = []
  selectedKeys.value = []
  cursor.value = 0
  scanned.value = false
  excludeTops.value = []
  filterText.value = ''
  allMode.value = false
  lastRefreshAt.value = null
  detail.value = null
  expandedKeys.value = []
}

/** 清空本地缓存数据二次确认 */
function onClearCache() {
  Modal.confirm({
    title: '确认清空本地缓存？',
    content: '会把本地缓存的这份列表一起清掉，回到什么都没加载的状态（服务端的数据不受影响）。',
    okText: '清空',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      clearCache()
      nsOpen.value = false
      message.success('本地缓存已清空')
    },
  })
}

onMounted(() => {
  loadInfo()
  const restored = restoreCache()
  if (restored === 'recipe' && allMode.value) loadAll(excludeTops.value)
  window.addEventListener('resize', syncWinHeight)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncWinHeight)
})
</script>

<template>
  <div class="g-redis">
    <!-- 工具栏 -->
    <div class="g-toolbar">
      <Input
        v-model:value="filterText"
        placeholder="筛选已加载的 key，支持 * 通配"
        style="width: 260px"
        allowClear
      />

      <Button @click="openCreate">
        <GIcon icon="ant-design:plus-outlined" :size="14" />
        <span class="g-btn-text">新建</span>
      </Button>

      <Button @click="cmdOpen = true">
        <GIcon icon="ant-design:code-outlined" :size="14" />
        <span class="g-btn-text">执行命令</span>
      </Button>

      <Button
        v-if="viewMode === 'list' && selectedKeys.length"
        danger
        @click="confirmDel(selectedKeys)"
      >
        <GIcon icon="ant-design:delete-outlined" :size="14" />
        <span class="g-btn-text">删除选中 ({{ selectedKeys.length }})</span>
      </Button>

      <div class="g-toolbar-right">
        <Segmented
          :value="viewMode"
          :options="VIEW_OPTIONS"
          size="small"
          @change="(v: any) => setViewMode(v)"
        />

        <div class="g-toolbar-info" v-if="info">
          共 {{ info.dbSize }} 个 key
          <template v-if="info.memory"> · 占用 {{ info.memory }}</template>
        </div>
      </div>
    </div>

    <div class="g-body">
      <!-- 左：key 列表 / 目录树 -->
      <div class="g-list">
        <!-- 卡片自己的头：左边报状态，右边放刷新/设置（展开/收起只在目录树视图出现） -->
        <div v-if="scanned" class="g-list-head">
          <span class="g-list-stat">
            已加载 {{ items.length }} 个 key<template v-if="filteredCount"> · 筛选出 {{ filteredCount }} 个</template>
            · 最后刷新 {{ refreshText }}
          </span>
          <div class="g-list-ops">
            <template v-if="viewMode === 'tree'">
              <Button type="link" size="small" @click="expandAllTree">展开全部</Button>
              <Button type="link" size="small" @click="expandedKeys = []">收起全部</Button>
            </template>
            <Button size="small" :loading="loadingAll" @click="onRefresh">
              <GIcon icon="ant-design:reload-outlined" :size="13" />
              <span class="g-btn-text">刷新</span>
            </Button>
            <Button size="small" @click="onSettings">
              <GIcon icon="ant-design:setting-outlined" :size="13" />
              <span class="g-btn-text">设置</span>
            </Button>
          </div>
        </div>

        <Table
          v-if="viewMode === 'list'"
          :columns="columns"
          :data-source="shownItems"
          row-key="key"
          size="small"
          :pagination="false"
          :scroll="{ x: 'max-content', y: 'calc(100vh - 352px)' }"
          :row-selection="{
            selectedRowKeys: selectedKeys,
            onChange: (keys: any) => (selectedKeys = keys as string[]),
          }"
          :custom-row="(record: RedisKeyItem) => ({ onClick: () => openDetail(record.key) })"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'key'">
              <span
                class="g-key"
                :class="{ 'g-key-active': detail?.key === record.key }"
              >{{ record.key }}</span>
            </template>

            <template v-else-if="column.key === 'type'">
              <Tag :color="TYPE_COLOR[record.type] ?? 'default'">{{ record.type }}</Tag>
            </template>

            <template v-else-if="column.key === 'ttl'">
              <span class="g-ttl">{{ ttlText(record.ttl) }}</span>
            </template>

            <template v-else-if="column.key === 'action'">
              <Button
                type="link"
                size="small"
                danger
                @click.stop="confirmDel([record.key])"
              >
                删除
              </Button>
            </template>
          </template>

          <template #emptyText>
            <Empty :description="emptyText" />
          </template>
        </Table>

        <template v-else>
          <Tree
            v-if="treeData.length"
            class="g-tree"
            :tree-data="treeData"
            :height="treeHeight"
            :style="{ height: `${treeHeight}px` }"
            :expanded-keys="expandedKeys"
            :selected-keys="treeSelectedKeys"
            :auto-expand-parent="false"
            expand-action="click"
            block-node
            @update:expandedKeys="(keys: any) => (expandedKeys = keys)"
            @select="onTreeSelect"
          >
            <template #title="node">
              <span class="g-tree-node">
                <span
                  class="g-tree-name"
                  :class="{ 'g-key-active': node.redisKey && detail?.key === node.redisKey }"
                  :title="node.redisKey || node.key"
                >{{ node.title || '(空)' }}</span>

                <template v-if="node.redisKey">
                  <Tag :color="TYPE_COLOR[node.type] ?? 'default'">{{ node.type }}</Tag>
                  <span class="g-ttl">{{ ttlText(node.ttl) }}</span>
                  <span class="g-tree-actions">
                    <Button
                      type="link"
                      size="small"
                      danger
                      @click.stop="confirmDel([node.redisKey])"
                    >
                      删除
                    </Button>
                  </span>
                </template>
                <span v-else-if="node.children?.length" class="g-tree-count">
                  {{ node.children.length }}
                </span>
              </span>
            </template>
          </Tree>

          <Empty v-else :description="emptyText" />
        </template>

        <div v-if="!fullyLoaded" class="g-more">
          <Button :loading="loadingAll" block @click="onLoadAll">
            {{ loadingAll ? `加载中…（已加载 ${items.length} 个）` : '加载数据' }}
          </Button>
        </div>
      </div>

      <!-- 右：详情 -->
      <div class="g-detail">
        <Spin :spinning="detailLoading && !detail">
          <template v-if="detail">
            <div class="g-detail-head">
              <div class="g-detail-key">{{ detail.key }}</div>
              <div class="g-detail-actions">
                <Button size="small" :loading="detailLoading" @click="openDetail(detail.key)">
                  <GIcon icon="ant-design:reload-outlined" :size="13" />
                </Button>
                <Button size="small" @click="openEdit(detail)">
                  <GIcon icon="ant-design:edit-outlined" :size="13" />
                  <span class="g-btn-text">编辑</span>
                </Button>
                <Button size="small" danger @click="confirmDel([detail.key])">
                  <GIcon icon="ant-design:delete-outlined" :size="13" />
                </Button>
              </div>
            </div>

            <div class="g-detail-meta">
              <Tag :color="TYPE_COLOR[detail.type] ?? 'default'">{{ detail.type }}</Tag>
              <span class="g-ttl">{{ ttlText(detail.ttl) }}</span>
              <Tag v-if="detail.truncated" color="warning">
                内容过多，仅显示前一部分
              </Tag>
            </div>

            <pre class="g-detail-value">{{ detailText }}</pre>
          </template>

          <Empty v-else-if="!detailLoading" description="点左侧的 key 查看内容" />
        </Spin>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <Modal
      v-model:open="editOpen"
      :title="editIsNew ? '新建 key' : '编辑 key'"
      :confirm-loading="editSaving"
      @ok="saveEdit"
      width="640px"
    >
      <div class="g-form-row">
        <label>Key</label>
        <Input v-model:value="editKey" :disabled="!editIsNew" placeholder="如 Yz:Guoba:foo" />
      </div>

      <div class="g-form-row">
        <label>类型</label>
        <Select v-model:value="editType" style="width: 100%" :disabled="!editIsNew">
          <SelectOption value="string">string</SelectOption>
          <SelectOption value="hash">hash（JSON 对象）</SelectOption>
        </Select>
      </div>

      <div class="g-form-row">
        <label>值</label>
        <Textarea
          v-model:value="editValue"
          :rows="10"
          :placeholder="editPlaceholder"
        />
      </div>

      <div class="g-form-row">
        <label>过期时间（秒）</label>
        <InputNumber
          v-model:value="editTtl"
          style="width: 100%"
          :min="0"
          placeholder="0 表示永不过期"
        />
      </div>
    </Modal>

    <!-- 加载数据：先勾要加载哪几个顶层 -->
    <Modal
      v-model:open="nsOpen"
      title="选择要加载的顶层"
      width="540px"
    >
      <Spin :spinning="nsLoading">
        <div class="g-ns-head">
          <span class="g-ns-tip">
            共 {{ nsList.length }} 个顶层，勾上的才会加载。
          </span>
          <span class="g-ns-ops">
            <Button type="link" size="small" @click="setAllNs(true)">全选</Button>
            <Button type="link" size="small" @click="setAllNs(false)">全不选</Button>
          </span>
        </div>

        <CheckboxGroup v-model:value="nsChecked" class="g-ns-list">
          <div v-for="n in nsList" :key="n.name" class="g-ns-row">
            <Checkbox :value="n.name">
              <span class="g-ns-name">{{ n.name }}</span>
            </Checkbox>
            <span class="g-ns-count">{{ n.count }}</span>
            <span class="g-ns-tag">
              <Tag v-if="n.message" color="orange">消息记录</Tag>
            </span>
          </div>
        </CheckboxGroup>

        <Empty v-if="!nsLoading && !nsList.length" description="没有匹配的 key" />
      </Spin>

      <template #footer>
        <div class="g-ns-footer">
          <Button danger @click="onClearCache">
            <GIcon icon="ant-design:delete-outlined" :size="13" />
            <span class="g-btn-text">清空本地缓存数据</span>
          </Button>
          <span class="g-ns-footer-right">
            <Button @click="nsOpen = false">取消</Button>
            <Button
              type="primary"
              :loading="nsLoading"
              :disabled="nsLoading || !nsList.length"
              @click="confirmLoadAll"
            >
              加载
            </Button>
          </span>
        </div>
      </template>
    </Modal>

    <!-- 命令弹窗 -->
    <Modal v-model:open="cmdOpen" title="执行 Redis 命令" width="680px" :footer="null">
      <div class="g-form-row">
        <Input
          v-model:value="cmdText"
          placeholder="如 GET Yz:foo、LPUSH list a b c"
          @pressEnter="runCommand"
        />
      </div>
      <Button type="primary" :loading="cmdRunning" @click="runCommand">
        <GIcon icon="ant-design:play-circle-outlined" :size="14" />
        <span class="g-btn-text">执行</span>
      </Button>
      <p class="g-cmd-tip">
        FLUSHALL、FLUSHDB、SHUTDOWN 等命令已被禁用。
      </p>
      <pre v-if="cmdReply" class="g-detail-value g-cmd-reply">{{ cmdReply }}</pre>
    </Modal>
  </div>
</template>

<style scoped>
.g-redis {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.g-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.g-toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.g-toolbar-info {
  /* 工具栏按钮多时不许压缩这段文字，否则会被截成半个字 */
  flex: none;
  white-space: nowrap;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-view-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.g-btn-text {
  margin-left: 6px;
}

.g-body {
  display: grid;
  /* 左列自适应，右列固定，窄屏时下面的媒体查询会改成上下排 */
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 12px;
  align-items: start;
}

.g-list,
.g-detail {
  background: var(--g-bg-card);
  border: 1px solid var(--g-border);
  border-radius: 10px;
  padding: 14px;
}

.g-detail {
  min-height: 240px;
}

.g-key {
  font-family: var(--g-font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 12px;
  cursor: pointer;
  word-break: break-all;
}

.g-key-active {
  color: var(--g-brand);
  font-weight: 600;
}

.g-ttl {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-more {
  padding: 8px 4px 4px;
}

/* ---------------- 目录树 ---------------- */

.g-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.g-list-stat {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-list-ops {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.g-tree {
  font-family: var(--g-font-mono, ui-monospace, Menlo, Consolas, monospace);
}

.g-tree :deep(.ant-tree-list-holder) {
  height: 100%;
}

.g-tree :deep(.ant-tree-node-content-wrapper) {
  height: auto;
  min-height: 24px;
  line-height: 22px;
}

.g-tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.g-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.g-tree-count {
  flex: none;
  font-size: 11px;
  color: var(--g-text-dim);
}

.g-tree-actions {
  flex: none;
  display: flex;
  gap: 2px;
}

.g-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.g-detail-key {
  font-family: var(--g-font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
  color: var(--g-text);
}

.g-detail-actions {
  display: flex;
  gap: 6px;
  flex: none;
}

.g-detail-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.g-detail-value {
  margin: 0;
  padding: 10px;
  max-height: calc(100vh - 420px);
  overflow: auto;
  background: var(--g-bg-soft);
  border: 1px solid var(--g-border);
  border-radius: 8px;
  font-family: var(--g-font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--g-text-sub);
}

.g-form-row {
  margin-bottom: 12px;
}

.g-form-row label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-ns-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.g-ns-tip {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-ns-ops {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.g-ns-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.g-ns-footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.g-ns-list {
  display: block;
  max-height: 320px;
  overflow: auto;
}

.g-ns-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 56px 68px;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.g-ns-row :deep(.ant-checkbox-wrapper) {
  min-width: 0;
  align-items: center;
}

.g-ns-name {
  font-family: var(--g-font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 12px;
  word-break: break-all;
}

.g-ns-count {
  text-align: right;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-ns-tag {
  display: flex;
  align-items: center;
}

.g-ns-tag :deep(.ant-tag) {
  margin-inline-end: 0;
}

.g-cmd-tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-cmd-reply {
  margin-top: 12px;
  max-height: 320px;
}

@media (max-width: 1100px) {
  .g-body {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  /* 筛选框的内联宽度是给桌面的，手机上占满一整行才好按 */
  .g-toolbar > :deep(.ant-input-affix-wrapper),
  .g-toolbar > :deep(.ant-input) {
    width: 100% !important;
  }

  /* 视图切换和 key 统计原来靠右贴，窄屏换行后独占一行，别再把页面撑宽 */
  .g-toolbar-right {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
    gap: 8px;
  }

  .g-toolbar-info {
    white-space: normal;
    font-size: 11px;
    text-align: right;
  }
}
</style>
