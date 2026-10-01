<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import SelectIconModal from './SelectIconModal.vue'
import {
  apiGetMiaoThemeConfig,
  apiPreviewMiaoHelp,
  miaoHelpIconUrl,
  miaoThemeBgUrl,
  miaoThemeMainUrl,
} from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useDrag } from '@/utils/useDrag'
import type { MiaoHelpCfgBody, MiaoHelpGroup, MiaoHelpItem } from '@/types'

/**
 * 帮助图编辑器。
 */
const props = defineProps<{
  cfg: MiaoHelpCfgBody
  list: MiaoHelpGroup[]
  miaoVersion: string
  yunzaiVersion: string
  editing?: { theme: string; style: Record<string, any> } | null
}>()

const auth = useAuthStore()

/** 雪碧图每行 10 格，和 miao Help.render 里的坐标换算一致 */
const SPRITE_COLS = 10

/* ---------------- 皮肤与配色 ---------------- */

/**
 * 预览用哪张皮肤。
 */
const previewTheme = computed(() => {
  const editing = props.editing?.theme
  if (editing) return editing
  const t = props.cfg.theme
  if (Array.isArray(t) && t.length) return t[0]
  if (typeof t === 'string' && t && t !== 'all') return t
  return 'default'
})

const fetchedStyle = ref<Record<string, any>>({})
const themeStyleError = ref('')

const themeStyle = computed<Record<string, any>>(() =>
  props.editing ? (props.editing.style ?? {}) : fetchedStyle.value,
)

/**
 * 手动重取的开关。
 */
const themeStyleVersion = ref(0)

watch(
  [previewTheme, themeStyleVersion],
  async ([name]) => {
    themeStyleError.value = ''
    if (props.editing) return
    try {
      const style = await apiGetMiaoThemeConfig(name)
      fetchedStyle.value = style && typeof style === 'object' ? style : {}
    } catch (e: any) {
      fetchedStyle.value = {}
      themeStyleError.value = e?.message || `读不到皮肤 ${name} 的配色`
    }
  },
  { immediate: true },
)

function refreshThemeStyle() {
  themeStyleVersion.value++
  imgTs.value = Date.now()
}

function pick(key: string, fallback: string | number) {
  const fromTheme = themeStyle.value?.[key]
  if (fromTheme !== undefined && fromTheme !== null && fromTheme !== '') return fromTheme
  const fromCfg = (props.cfg as any)[key]
  if (fromCfg !== undefined && fromCfg !== null && fromCfg !== '') return fromCfg
  return fallback
}

/**
 * 取颜色
 */
function color(key: string, fallback: string) {
  const value = String(pick(key, fallback))
  const v = value.trim()
  if (!v) return fallback
  if (!CSS.supports('color', v) && !CSS.supports('background-image', v)) return fallback
  return value
}

/* ---------------- 尺寸 ---------------- */

const colCount = computed(() => {
  const n = parseInt(String(props.cfg.colCount), 10)
  return Math.min(5, Math.max(Number.isFinite(n) ? n : 3, 2))
})

const colWidth = computed(() => {
  const n = parseInt(String(props.cfg.colWidth), 10)
  return Math.min(500, Math.max(Number.isFinite(n) ? n : 265, 100))
})

/** 与 HelpTheme 完全一致：min(2500, max(800, colCount * colWidth + 30)) */
const wrapWidth = computed(() => Math.min(2500, Math.max(800, colCount.value * colWidth.value + 30)))

const imgTs = ref(Date.now())
const spriteUrl = computed(() => miaoHelpIconUrl(auth.token, imgTs.value))
const mainUrl = computed(() => miaoThemeMainUrl(previewTheme.value, auth.liteToken || auth.token, imgTs.value))
const bgUrl = computed(() => miaoThemeBgUrl(previewTheme.value, auth.liteToken || auth.token, imgTs.value))

/* ---------------- 行拆分 ---------------- */

/**
 * 占位格。
 */
const EMPTY_CELL: MiaoHelpItem = { __empty: true }

function isEmptyCell(cell: MiaoHelpItem) {
  return cell === EMPTY_CELL
}

interface GroupRows {
  group: MiaoHelpGroup
  groupIndex: number
  rows: { cell: MiaoHelpItem; index: number }[][]
}

const groupRows = computed<GroupRows[]>(() =>
  props.list.map((group, groupIndex) => {
    const items = Array.isArray(group.list) ? group.list : []
    const rows: { cell: MiaoHelpItem; index: number }[][] = []
    if (items.length) {
      let row: { cell: MiaoHelpItem; index: number }[] = []
      items.forEach((item, idx) => {
        row.push({ cell: item, index: idx })
        const isRowEnd = idx % colCount.value === colCount.value - 1
        if (isRowEnd && idx > 0 && idx < items.length - 1) {
          rows.push(row)
          row = []
        }
      })
      for (let i = (items.length - 1) % colCount.value; i < colCount.value - 1; i++) {
        row.push({ cell: EMPTY_CELL, index: -1 })
      }
      rows.push(row)
    }
    return { group, groupIndex, rows }
  }),
)

/* ---------------- 缩放到容器宽度 ---------------- */

const viewportEl = ref<HTMLElement>()
const replicaEl = ref<HTMLElement>()
const viewportW = ref(0)
const replicaH = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // ResizeObserver 报的是布局尺寸，不含 transform，所以 replicaH 是缩放前的高度
      if (entry.target === viewportEl.value) viewportW.value = entry.contentRect.width
      else replicaH.value = entry.contentRect.height
    }
  })
  if (viewportEl.value) observer.observe(viewportEl.value)
  if (replicaEl.value) observer.observe(replicaEl.value)
})

onUnmounted(() => observer?.disconnect())

const scale = computed(() => {
  if (!viewportW.value || !wrapWidth.value) return 1
  return Math.min(1, viewportW.value / wrapWidth.value)
})

const stageStyle = computed(() => ({
  width: `${wrapWidth.value * scale.value}px`,
  height: replicaH.value ? `${replicaH.value * scale.value}px` : 'auto',
}))

const replicaStyle = computed(() => ({
  width: `${wrapWidth.value}px`,
  backgroundImage: `url(${bgUrl.value})`,
  transform: `scale(${scale.value})`,
  '--miao-main': `url(${mainUrl.value})`,
  '--miao-td-width': `${100 / colCount.value}%`,
  '--miao-title-color': color('fontColor', '#ceb78b'),
  '--miao-title-shadow': String(pick('fontShadow', 'none')),
  '--miao-desc-color': color('descColor', '#eee'),
  '--miao-desc-shadow': String(pick('descShadow', 'none')),
  '--miao-cont-bg': color('contBgColor', 'rgba(43, 52, 61, 0.8)'),
  // bgBlur 为 false 时 HelpTheme 直接输出 backdrop-filter:none
  '--miao-cont-blur': props.cfg.bgBlur === false ? 'none' : `blur(${pick('contBgBlur', 3)}px)`,
  '--miao-header-bg': color('headerBgColor', 'rgba(34, 41, 51, .4)'),
  '--miao-row1-bg': color('rowBgColor1', 'rgba(34, 41, 51, .2)'),
  '--miao-row2-bg': color('rowBgColor2', 'rgba(34, 41, 51, .4)'),
}))

/* ---------------- 图标 ---------------- */

const iconReplacements = ref<Record<number, string>>({})
const iconExtraRows = ref(0)
const iconModalOpen = ref(false)

function iconStyle(icon: number) {
  const replacement = iconReplacements.value[icon]
  if (replacement) {
    return {
      backgroundImage: `url(${replacement})`,
      backgroundPosition: '0 0',
      backgroundSize: '50px 50px',
    }
  }
  const x = (icon - 1) % SPRITE_COLS
  const y = Math.floor((icon - 1) / SPRITE_COLS)
  return {
    backgroundImage: `url(${spriteUrl.value})`,
    backgroundPosition: `${-x * 50}px ${-y * 50}px`,
    backgroundSize: '500px auto',
  }
}

const ICON_VISIBLE = 0.8

function iconCellStyle(icon: number, box: number) {
  const cell = box / ICON_VISIBLE
  const replacement = iconReplacements.value[icon]
  if (replacement) {
    // 替换图是整格画进雪碧图的，出图时同样只露左上 80%，预览照做
    return {
      backgroundImage: `url(${replacement})`,
      backgroundPosition: '0 0',
      backgroundSize: `${cell}px ${cell}px`,
    }
  }
  const x = (icon - 1) % SPRITE_COLS
  const y = Math.floor((icon - 1) / SPRITE_COLS)
  return {
    backgroundImage: `url(${spriteUrl.value})`,
    backgroundPosition: `${-x * cell}px ${-y * cell}px`,
    backgroundSize: `${cell * SPRITE_COLS}px auto`,
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图标文件加载失败，请刷新页面重试'))
    img.src = src
  })
}

async function buildIconFile(): Promise<File | null> {
  const replacements = iconReplacements.value
  const entries = Object.entries(replacements)
  if (!entries.length && !iconExtraRows.value) return null

  const sprite = await loadImage(spriteUrl.value)
  const cell = Math.round(sprite.naturalWidth / SPRITE_COLS)
  const rows = Math.round(sprite.naturalHeight / cell) + iconExtraRows.value
  const canvas = document.createElement('canvas')
  canvas.width = cell * SPRITE_COLS
  canvas.height = cell * rows
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持画布，无法保存图标')

  ctx.drawImage(sprite, 0, 0, sprite.naturalWidth, sprite.naturalHeight)
  for (const [key, dataUrl] of entries) {
    const index = Number(key)
    if (!Number.isFinite(index) || index < 1) continue
    const img = await loadImage(dataUrl)
    const x = (index - 1) % SPRITE_COLS
    const y = Math.floor((index - 1) / SPRITE_COLS)
    ctx.drawImage(img, x * cell, y * cell, cell, cell)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('图标生成失败')
  return new File([blob], 'icon.png', { type: 'image/png' })
}

function resetIconEdits() {
  iconReplacements.value = {}
  iconExtraRows.value = 0
  imgTs.value = Date.now()
}

defineExpose({ buildIconFile, resetIconEdits, refreshThemeStyle })

/* ---------------- 编辑弹窗 ---------------- */

interface ModelData {
  show: boolean
  cell: MiaoHelpItem | null
  cellIndex: number | null
  group: MiaoHelpGroup | null
  groupIndex: number | null
}

const modelData = reactive<ModelData>({
  show: false,
  cell: null,
  cellIndex: null,
  group: null,
  groupIndex: null,
})

const headOpen = ref(false)
const { offset: itemOffset, onDown: onItemDrag, reset: resetItemDrag } = useDrag()

function ensureList(group: MiaoHelpGroup | null): MiaoHelpItem[] {
  if (!group) return []
  if (!Array.isArray(group.list)) group.list = []
  return group.list
}

function openHead() {
  headOpen.value = true
}

function openGroup(group: MiaoHelpGroup, groupIndex: number) {
  modelData.cell = null
  modelData.cellIndex = null
  modelData.group = group
  modelData.groupIndex = groupIndex
  modelData.show = true
  resetItemDrag()
}

function openCell(cell: MiaoHelpItem, cellIndex: number, group: MiaoHelpGroup, groupIndex: number) {
  modelData.cell = cell
  modelData.cellIndex = cellIndex
  modelData.group = group
  modelData.groupIndex = groupIndex
  modelData.show = true
  resetItemDrag()
}

function onCellClick(
  cell: MiaoHelpItem,
  cellIndex: number,
  group: MiaoHelpGroup,
  groupIndex: number,
) {
  if (isEmptyCell(cell)) return
  openCell(cell, cellIndex, group, groupIndex)
}

const groupItemCount = computed(() => modelData.group?.list?.length ?? 0)

/** antd 的 Switch 回调类型是 CheckedType（boolean | string | number），这里只会给 boolean */
function setGroupAuth(value: boolean | string | number) {
  if (modelData.group) modelData.group.auth = value ? 'master' : undefined
}

function closeItem() {
  modelData.show = false
  modelData.cell = null
  modelData.cellIndex = null
  modelData.group = null
  modelData.groupIndex = null
}

function createGroup() {
  const index = modelData.groupIndex ?? props.list.length
  props.list.splice(index, 0, { group: '未命名组别', list: [] })
  modelData.group = props.list[index]
  modelData.groupIndex = index
  modelData.cell = null
  modelData.cellIndex = null
}

function createCell() {
  const list = ensureList(modelData.group)
  const index = modelData.cellIndex ?? 0
  list.splice(index, 0, { icon: 1, title: '未命名项目', desc: '请添加描述' })
  modelData.cell = list[index]
  modelData.cellIndex = index
}

function deleteGroup() {
  if (modelData.groupIndex === null) return
  props.list.splice(modelData.groupIndex, 1)
  closeItem()
}

function deleteCell() {
  if (modelData.cellIndex === null) return
  ensureList(modelData.group).splice(modelData.cellIndex, 1)
  closeItem()
}

function moveGroup(step: number) {
  const i = modelData.groupIndex
  if (i === null) return
  const j = i + step
  if (j < 0 || j >= props.list.length) return
  ;[props.list[i], props.list[j]] = [props.list[j], props.list[i]]
  modelData.groupIndex = j
}

function moveCell(step: number) {
  const i = modelData.cellIndex
  const list = modelData.group?.list
  if (i === null || !list) return
  const j = i + step
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  modelData.cellIndex = j
}

function onIconSelected(index: number) {
  if (modelData.cell) modelData.cell.icon = index
}

/* ---------------- 真实出图 ---------------- */

const renderOpen = ref(false)
const renderLoading = ref(false)
const renderImage = ref('')
const renderError = ref('')

async function renderReal() {
  renderOpen.value = true
  renderLoading.value = true
  renderError.value = ''
  try {
    const data = await apiPreviewMiaoHelp(props.cfg, props.list)
    if (data?.image) {
      renderImage.value = data.image
    } else {
      renderError.value = '出图失败，请稍后重试'
    }
  } catch (e: any) {
    renderError.value = e?.message || '出图失败，请稍后重试'
  } finally {
    renderLoading.value = false
  }
}

function addGroup() {
  props.list.push({ group: '未命名组别', list: [] })
  const index = props.list.length - 1
  openGroup(props.list[index], index)
  message.success('已新增分组，在弹窗里改个名字')
}

/* ---------------- 拖动换位置 ---------------- */

const draggingCell = ref<{ gi: number; ci: number } | null>(null)
const dropCell = ref<{ gi: number; ci: number } | null>(null)

function isDraggingCell(gi: number, ci: number) {
  return draggingCell.value?.gi === gi && draggingCell.value?.ci === ci
}

function isDropTarget(gi: number, ci: number) {
  return !!draggingCell.value && dropCell.value?.gi === gi && dropCell.value?.ci === ci
}

function onCellDragStart(gi: number, ci: number, e: DragEvent) {
  if (ci < 0) return
  draggingCell.value = { gi, ci }
  if (e.dataTransfer) {
    // Firefox 不塞点数据就根本不会开始拖
    e.dataTransfer.setData('text/plain', `${gi}:${ci}`)
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onCellDragOver(gi: number, ci: number, e: DragEvent) {
  if (!draggingCell.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropCell.value = { gi, ci }
}

function onCellDragLeave(gi: number, ci: number, e: DragEvent) {
  const el = e.currentTarget as HTMLElement | null
  if (el && e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
  if (dropCell.value?.gi === gi && dropCell.value?.ci === ci) dropCell.value = null
}

function clearCellDrag() {
  draggingCell.value = null
  dropCell.value = null
}

/**
 * 把被拖的那格放到落点上。
 */
function onCellDrop(gi: number, ci: number) {
  const from = draggingCell.value
  clearCellDrag()
  if (!from || (from.gi === gi && from.ci === ci)) return
  const fromList = props.list[from.gi]?.list
  const toList = props.list[gi]?.list
  if (!fromList || !toList) return

  const [item] = fromList.splice(from.ci, 1)
  toList.splice(ci < 0 ? toList.length : Math.min(ci, toList.length), 0, item)

  const editing = modelData.cell
  if (editing) {
    const owner = props.list.find((g) => ensureList(g).includes(editing))
    if (owner) {
      modelData.group = owner
      modelData.groupIndex = props.list.indexOf(owner)
      modelData.cellIndex = ensureList(owner).indexOf(editing)
    }
  }
}
</script>

<template>
  <Card :bordered="false" class="g-miao-card">
    <template #title><span class="g-miao-title">帮助图</span></template>
    <template #extra>
      <Space>
        <Tooltip title="左边这张图画的是这个皮肤。出图时用哪个皮肤，由「帮助设置 → 皮肤」决定。">
          <Tag class="g-preview-tag">预览皮肤：{{ previewTheme }}</Tag>
        </Tooltip>
        <Tooltip title="按当前配置走一遍喵喵的真实出图（比较慢）">
          <Button size="small" :loading="renderLoading" @click="renderReal">
            <GIcon icon="ant-design:camera-outlined" :size="13" />
            <span class="g-btn-text">真实出图</span>
          </Button>
        </Tooltip>
        <Button size="small" @click="addGroup">
          <GIcon icon="ant-design:plus-outlined" :size="12" />
          <span class="g-btn-text">新增分组</span>
        </Button>
      </Space>
    </template>

    <p class="g-hint">
      点标题改标题，点分组名改分组，点任意一格改那一条命令；按住任意一格拖到别处可以换位置。
      配色在右边「皮肤管理」里改，改一下这边立刻跟着变。
    </p>

    <Alert
      v-if="themeStyleError"
      type="warning"
      show-icon
      class="g-editor-alert"
      :message="themeStyleError"
    />

    <div ref="viewportEl" class="g-viewport">
      <div class="g-stage" :style="stageStyle">
        <div ref="replicaEl" class="g-replica" :style="replicaStyle">
          <div class="miao-container">
            <div class="info-box">
              <div class="head-box" title="点击编辑标题" @click="openHead">
                <div class="title">{{ cfg.title || '使用帮助' }}</div>
                <div class="label">{{ cfg.subTitle || 'Yunzai-Bot & Miao-Plugin' }}</div>
              </div>
            </div>

            <div v-for="item in groupRows" :key="item.groupIndex" class="cont-box">
              <div
                class="help-group"
                title="点击编辑这个分组"
                @click="openGroup(item.group, item.groupIndex)"
              >
                {{ item.group.group }}
              </div>

              <div v-if="item.rows.length" class="help-table">
                <div v-for="(row, rowIndex) in item.rows" :key="rowIndex" class="tr">
                  <div
                    v-for="(slot, colIndex) in row"
                    :key="colIndex"
                    class="td"
                    :class="{
                      'is-empty': isEmptyCell(slot.cell),
                      'is-dragging': isDraggingCell(item.groupIndex, slot.index),
                      'is-drop-over': isDropTarget(item.groupIndex, slot.index),
                    }"
                    :draggable="!isEmptyCell(slot.cell)"
                    :title="
                      isEmptyCell(slot.cell)
                        ? undefined
                        : `点击编辑、按住拖动可换位置：${slot.cell.title || '未命名'}`
                    "
                    @click="onCellClick(slot.cell, slot.index, item.group, item.groupIndex)"
                    @dragstart="onCellDragStart(item.groupIndex, slot.index, $event)"
                    @dragover="onCellDragOver(item.groupIndex, slot.index, $event)"
                    @dragleave="onCellDragLeave(item.groupIndex, slot.index, $event)"
                    @drop="onCellDrop(item.groupIndex, slot.index)"
                    @dragend="clearCellDrag"
                  >
                    <span
                      v-if="slot.cell.icon"
                      class="help-icon"
                      :style="iconStyle(slot.cell.icon)"
                    />
                    <strong class="help-title">{{ slot.cell.title }}</strong>
                    <span class="help-desc">{{ slot.cell.desc }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="copyright">
              Created By Yunzai-Bot<span class="version">{{ yunzaiVersion }}</span>
              &amp; Miao-Plugin<span class="version">{{ miaoVersion }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑标题 -->
    <Modal v-model:open="headOpen" title="编辑标题" :footer="null" :width="440">
      <div class="g-field">
        <span class="g-field-label">主标题</span>
        <Input v-model:value="cfg.title" placeholder="使用帮助" allowClear />
      </div>
      <div class="g-field">
        <span class="g-field-label">副标题</span>
        <Input v-model:value="cfg.subTitle" placeholder="Yunzai-Bot & Miao-Plugin" allowClear />
      </div>
    </Modal>

    <Modal
      :open="modelData.show"
      :footer="null"
      :mask="false"
      :width="460"
      wrap-class-name="g-edit-modal"
      @update:open="modelData.show = $event"
    >
      <template #title>
        <div class="g-drag-handle" @pointerdown="onItemDrag">
          {{ modelData.cell ? '编辑命令' : '编辑分组' }}
          <span class="g-drag-tip">按住这里可拖动</span>
        </div>
      </template>

      <template #modalRender="{ originVNode }">
        <div :style="{ transform: `translate(${itemOffset.x}px, ${itemOffset.y}px)` }">
          <component :is="originVNode" />
        </div>
      </template>

      <template v-if="modelData.group && !modelData.cell">
        <div class="g-field">
          <span class="g-field-label">分组</span>
          <Input v-model:value="modelData.group.group" placeholder="分组名称" />
        </div>

        <div class="g-field">
          <span class="g-field-label">仅主人</span>
          <Switch
            :checked="modelData.group.auth === 'master'"
            checked-children="是"
            un-checked-children="否"
            @update:checked="setGroupAuth"
          />
        </div>

        <div class="g-ops">
          <Space :size="6">
            <Button
              type="primary"
              shape="circle"
              :disabled="modelData.groupIndex === 0"
              @click="moveGroup(-1)"
            >
              <GIcon icon="ant-design:arrow-up-outlined" :size="12" />
            </Button>
            <Button
              type="primary"
              shape="circle"
              :disabled="modelData.groupIndex === list.length - 1"
              @click="moveGroup(1)"
            >
              <GIcon icon="ant-design:arrow-down-outlined" :size="12" />
            </Button>
          </Space>
          <Space :size="6">
            <Button @click="createCell">添加项目</Button>
            <Button type="primary" @click="createGroup">添加分组</Button>
            <Popconfirm title="删除该分组及其下所有命令？" ok-text="删除" cancel-text="取消" @confirm="deleteGroup">
              <Button danger>删除该组</Button>
            </Popconfirm>
          </Space>
        </div>
      </template>

      <template v-if="modelData.group && modelData.cell">
        <div class="g-icon-picker" title="点击选择图标" @click="iconModalOpen = true">
          <span
            v-if="modelData.cell.icon"
            class="g-icon-preview"
            :style="iconCellStyle(modelData.cell.icon, 60)"
          />
          <span v-else class="g-icon-preview is-none">无图标</span>
          <span class="g-icon-tip">点这里换图标（当前第 {{ modelData.cell.icon || 0 }} 个）</span>
        </div>

        <div class="g-field">
          <span class="g-field-label">标题</span>
          <Input v-model:value="modelData.cell.title" placeholder="标题" />
        </div>

        <div class="g-field">
          <span class="g-field-label">描述</span>
          <Input v-model:value="modelData.cell.desc" placeholder="描述" />
        </div>

        <div class="g-ops">
          <Space :size="6">
            <Button
              type="primary"
              shape="circle"
              :disabled="modelData.cellIndex === 0"
              @click="moveCell(-1)"
            >
              <GIcon icon="ant-design:arrow-left-outlined" :size="12" />
            </Button>
            <Button
              type="primary"
              shape="circle"
              :disabled="modelData.cellIndex === groupItemCount - 1"
              @click="moveCell(1)"
            >
              <GIcon icon="ant-design:arrow-right-outlined" :size="12" />
            </Button>
          </Space>
          <Space :size="6">
            <Button type="primary" @click="createCell">添加项目</Button>
            <Popconfirm title="删除该条命令？" ok-text="删除" cancel-text="取消" @confirm="deleteCell">
              <Button danger>删除该项</Button>
            </Popconfirm>
          </Space>
        </div>
      </template>
    </Modal>

    <SelectIconModal
      v-model:open="iconModalOpen"
      :current="modelData.cell?.icon"
      :sprite-url="spriteUrl"
      v-model:replacements="iconReplacements"
      v-model:extra-rows="iconExtraRows"
      @select="onIconSelected"
    />

    <!-- 真实出图：跟前端还原的版本对一眼，确认没有偏差 -->
    <Modal
      v-model:open="renderOpen"
      title="真实出图"
      :footer="null"
      :width="900"
      wrap-class-name="g-render-modal"
    >
      <Alert
        v-if="renderError"
        type="warning"
        show-icon
        :message="renderError"
        class="g-editor-alert"
      />
      <div v-else-if="renderLoading" class="g-render-loading">正在出图，请稍候…</div>
      <div v-else class="g-render-wrap">
        <img v-if="renderImage" :src="renderImage" alt="喵喵帮助真实出图" class="g-render-img" />
      </div>
    </Modal>
  </Card>
</template>

<style scoped>
.g-miao-card {
  margin-bottom: 16px;
}

.g-miao-title {
  font-size: 15px;
  font-weight: 600;
}

.g-preview-tag {
  margin-inline-end: 0;
  font-size: 12px;
  color: var(--g-text-sub);
}

.g-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--g-text-sub);
}

.g-editor-alert {
  margin-bottom: 12px;
}

.g-viewport {
  width: 100%;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--g-border);
  border-radius: 10px;
  background: var(--g-bg-soft);
}

.g-stage {
  position: relative;
  margin: 0 auto;
}

/* ---------- 以下样式照抄 miao-plugin/resources/help/index.css ---------- */

.g-replica {
  transform-origin: 0 0;
  background-repeat: repeat;
  background-position: 0 0;
  color: #1e1f20;
  font-size: 18px;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', sans-serif;
}

.g-replica .miao-container {
  /* common.css: padding 20px 15px 10px 15px / index.css: 底图左上、宽 100% 不重复 */
  padding: 20px 15px 10px;
  background-image: var(--miao-main);
  background-position: top left;
  background-repeat: no-repeat;
  background-size: 100% auto;
}

.g-replica .head-box {
  border-radius: 15px;
  padding: 10px 20px;
  position: relative;
  color: #fff;
  margin: 60px 0 0;
  padding-bottom: 0;
  cursor: pointer;
}

.g-replica .head-box .title {
  font-size: 50px;
  text-shadow: 0 0 1px #000, 1px 1px 3px rgba(0, 0, 0, 0.9);
}

.g-replica .head-box .label {
  font-size: 16px;
  text-shadow: 0 0 1px #000, 1px 1px 3px rgba(0, 0, 0, 0.9);
}

.g-replica .cont-box {
  border-radius: 15px;
  margin-top: 20px;
  margin-bottom: 20px;
  overflow: hidden;
  box-shadow: 0 5px 10px 0 rgba(0, 0, 0, 0.15);
  position: relative;
  background: var(--miao-cont-bg);
  -webkit-backdrop-filter: var(--miao-cont-blur);
  backdrop-filter: var(--miao-cont-blur);
}

.g-replica .help-group {
  font-size: 18px;
  font-weight: bold;
  padding: 15px 15px 10px 20px;
  color: var(--miao-title-color);
  text-shadow: var(--miao-title-shadow);
  background: var(--miao-header-bg);
  cursor: pointer;
}

.g-replica .help-table {
  text-align: center;
  border-collapse: collapse;
  margin: 0;
  border-radius: 0 0 10px 10px;
  display: table;
  overflow: hidden;
  width: 100%;
  color: #fff;
}

.g-replica .help-table .tr {
  display: table-row;
}

.g-replica .help-table .tr:nth-child(odd) {
  background: var(--miao-row1-bg);
}

.g-replica .help-table .tr:nth-child(even) {
  background: var(--miao-row2-bg);
}

.g-replica .help-table .td {
  font-size: 14px;
  display: table-cell;
  width: var(--miao-td-width);
  box-shadow: 0 0 1px 0 #888 inset;
  padding: 12px 0 12px 50px;
  line-height: 24px;
  position: relative;
  text-align: left;
  transition: all 0.2s;
}

.g-replica .help-table .tr:last-child .td {
  padding-bottom: 12px;
}

.g-replica .help-table .td:not(.is-empty) {
  cursor: pointer;
}

.g-replica .help-table .td:not(.is-empty):hover {
  box-shadow: 0 0 0 2px var(--g-brand) inset;
}

/* 拖动换位置：被拖走的那格淡下去，落点描一圈亮边。占位格也能当落点，表示追加到末尾 */
.g-replica .help-table .td.is-dragging {
  opacity: 0.35;
}

.g-replica .help-table .td.is-drop-over {
  box-shadow: 0 0 0 2px var(--g-brand) inset;
  background: rgba(255, 255, 255, 0.14);
}

.g-replica .help-icon {
  width: 40px;
  height: 40px;
  display: block;
  position: absolute;
  border-radius: 5px;
  left: 6px;
  top: 12px;
  transform: scale(0.85);
  background-repeat: no-repeat;
}

.g-replica .help-title {
  display: block;
  font-size: 16px;
  line-height: 24px;
  color: var(--miao-title-color);
  text-shadow: var(--miao-title-shadow);
}

.g-replica .help-desc {
  display: block;
  font-size: 13px;
  line-height: 18px;
  color: var(--miao-desc-color);
  text-shadow: var(--miao-desc-shadow);
}

.g-replica .copyright {
  font-size: 14px;
  text-align: center;
  color: #fff;
  position: relative;
  padding-left: 10px;
  text-shadow: 1px 1px 1px #000;
  margin: 10px 0;
}

.g-replica .copyright .version {
  color: #d3bc8e;
  display: inline-block;
  padding: 0 3px;
}

/* ---------- 编辑弹窗 ---------- */

.g-drag-handle {
  cursor: move;
}

.g-drag-tip {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--g-text-dim);
}

.g-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.g-field-label {
  width: 56px;
  flex: none;
  text-align: right;
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-ops {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.g-icon-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  cursor: pointer;
}

.g-icon-preview {
  width: 60px;
  height: 60px;
  flex: none;
  border-radius: 6px;
  background-repeat: no-repeat;
  background-color: var(--g-bg-soft);
  box-shadow: 0 0 12px var(--g-border);
}

.g-icon-preview.is-none {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-icon-tip {
  font-size: 12px;
  color: var(--g-text-sub);
}

/* ---------- 真实出图 ---------- */

.g-render-loading {
  padding: 40px 0;
  text-align: center;
  color: var(--g-text-sub);
}

.g-render-wrap {
  max-height: calc(100vh - 220px);
  overflow: auto;
  text-align: center;
}

.g-render-img {
  display: block;
  margin: 0 auto;
  max-width: 100%;
}

.g-btn-text {
  margin-left: 4px;
}
</style>

<style>
.g-edit-modal {
  pointer-events: none;
}

.g-edit-modal .ant-modal {
  pointer-events: auto;
}
</style>
