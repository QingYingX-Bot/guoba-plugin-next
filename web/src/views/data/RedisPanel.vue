<script setup lang="ts">
/**
 * Redis 浏览器。
 *
 * key 列表用 SCAN 游标翻页（后端同样走 SCAN，不用 KEYS，
 * 避免 key 多时阻塞 Redis）。所以只有「加载更多」，没有跳页。
 */
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Button,
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
  apiRedisScan,
  apiRedisSet,
  type RedisKeyItem,
  type RedisKeyType,
  type RedisValue,
} from '@/api'

/** Yunzai 自己的 key 都以 Yz: 开头，作为默认筛选省得混进别的应用的数据 */
const PRESETS = [
  { label: '全部', value: '*' },
  { label: 'Yunzai (Yz:*)', value: 'Yz:*' },
  { label: '锅巴 (Yz:Guoba:*)', value: 'Yz:Guoba:*' },
]

const info = ref<{ dbSize: number; memory: string } | null>(null)
const items = ref<RedisKeyItem[]>([])
const match = ref('*')
const loading = ref(false)
const loadingMore = ref(false)
/** SCAN 游标，0 表示已经扫完一轮 */
const cursor = ref(0)
const scanned = ref(false)
const selectedKeys = ref<string[]>([])

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

const treeHeight = computed(() => Math.max(240, winHeight.value - 305))

const treeSelectedKeys = computed(() => (detail.value ? [detail.value.key] : []))

/** 已加载的 key 按 `:` 拆成分层结构 */
const treeData = computed<RedisTreeNode[]>(() => {
  const byPath = new Map<string, RedisTreeNode>()
  const roots: RedisTreeNode[] = []
  for (const item of items.value) {
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

/** 重新扫描。reset 时清空已有结果并把游标归零 */
async function scan(reset = true) {
  if (reset) {
    loading.value = true
    cursor.value = 0
    items.value = []
    selectedKeys.value = []
  } else {
    loadingMore.value = true
  }
  try {
    const data = await apiRedisScan({
      cursor: reset ? 0 : cursor.value,
      match: match.value || '*',
      count: 200,
    })
    items.value = reset ? data.items : [...items.value, ...data.items]
    cursor.value = data.cursor
    scanned.value = true
    if (reset) {
      expandedKeys.value = treeData.value
        .filter((n) => n.children?.length)
        .map((n) => n.key)
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
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
    await Promise.all([scan(true), loadInfo()])
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
      if (detail.value && keys.includes(detail.value.key)) {
        detail.value = null
      }
      selectedKeys.value = []
      await Promise.all([scan(true), loadInfo()])
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
    await Promise.all([scan(true), loadInfo()])
  } catch (e: any) {
    cmdReply.value = `错误：${e?.message ?? e}`
  } finally {
    cmdRunning.value = false
  }
}

onMounted(() => {
  loadInfo()
  scan(true)
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
      <Select v-model:value="match" style="width: 180px" @change="scan(true)">
        <SelectOption v-for="p in PRESETS" :key="p.value" :value="p.value">
          {{ p.label }}
        </SelectOption>
      </Select>

      <Input
        v-model:value="match"
        placeholder="匹配模式，如 Yz:*"
        style="width: 220px"
        allowClear
        @pressEnter="scan(true)"
      />

      <Button type="primary" :loading="loading" @click="scan(true)">
        <GIcon icon="ant-design:search-outlined" :size="14" />
        <span class="g-btn-text">扫描</span>
      </Button>

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
        <Table
          v-if="viewMode === 'list'"
          :columns="columns"
          :data-source="items"
          row-key="key"
          size="small"
          :pagination="false"
          :scroll="{ x: 'max-content', y: 'calc(100vh - 320px)' }"
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
            <Empty :description="scanned ? '没有匹配的 key' : '点击扫描开始'" />
          </template>
        </Table>

        <template v-else>
          <div v-if="treeData.length" class="g-tree-bar">
            <span class="g-tree-stat">已加载 {{ items.length }} 个 key</span>
            <div class="g-tree-ops">
              <Button type="link" size="small" @click="expandAllTree">展开全部</Button>
              <Button type="link" size="small" @click="expandedKeys = []">收起全部</Button>
            </div>
          </div>

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

          <Empty v-else :description="scanned ? '没有匹配的 key' : '点击扫描开始'" />
        </template>

        <div v-if="hasMore" class="g-more">
          <Button :loading="loadingMore" block @click="scan(false)">
            加载更多
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

.g-tree-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.g-tree-stat {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-tree-ops {
  display: flex;
  align-items: center;
  gap: 4px;
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
</style>
