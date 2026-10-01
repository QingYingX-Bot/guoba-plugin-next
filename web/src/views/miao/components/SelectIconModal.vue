<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Alert, Button, Modal, Space, Spin, message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { useDrag } from '@/utils/useDrag'

/**
 * 图标选择器。
 */
const props = defineProps<{
  open: boolean
  current?: number
  spriteUrl: string
  replacements: Record<number, string>
  extraRows: number
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [index: number]
  'update:replacements': [value: Record<number, string>]
  'update:extraRows': [value: number]
}>()

const COLS = 10
const CELL_DISPLAY = 50

const { offset, onDown, reset } = useDrag()

const editMode = ref(false)
const spriteLoading = ref(false)
const spriteError = ref('')
const spriteSize = ref({ w: 0, h: 0 })

const cellSize = computed(() =>
  spriteSize.value.w ? Math.round(spriteSize.value.w / COLS) : 0,
)
const spriteRows = computed(() =>
  cellSize.value ? Math.round(spriteSize.value.h / cellSize.value) : 0,
)
const totalCells = computed(() => (spriteRows.value + props.extraRows) * COLS)
const baseCells = computed(() => spriteRows.value * COLS)

const replacedCount = computed(() => Object.keys(props.replacements).length)

function loadSprite() {
  spriteError.value = ''
  if (!props.spriteUrl) {
    spriteError.value = '拿不到图标文件地址，请刷新页面重试'
    return
  }
  spriteLoading.value = true
  const img = new Image()
  img.onload = () => {
    spriteSize.value = { w: img.naturalWidth, h: img.naturalHeight }
    spriteLoading.value = false
  }
  img.onerror = () => {
    spriteError.value = '图标文件加载失败，请刷新页面重试'
    spriteLoading.value = false
  }
  img.src = props.spriteUrl
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    editMode.value = false
    reset()
    if (!spriteSize.value.w) loadSprite()
  },
)

function cellStyle(index: number) {
  const replacement = props.replacements[index]
  if (replacement) {
    return {
      backgroundImage: `url(${replacement})`,
      backgroundPosition: '0 0',
      backgroundSize: `${CELL_DISPLAY}px ${CELL_DISPLAY}px`,
    }
  }
  if (index > baseCells.value) {
    return {}
  }
  const x = (index - 1) % COLS
  const y = Math.floor((index - 1) / COLS)
  return {
    backgroundImage: `url(${props.spriteUrl})`,
    backgroundPosition: `${-x * CELL_DISPLAY}px ${-y * CELL_DISPLAY}px`,
    backgroundSize: `${CELL_DISPLAY * COLS}px ${CELL_DISPLAY * COLS}px`,
  }
}

function onClickCell(index: number) {
  if (editMode.value) {
    pickReplacement(index)
    return
  }
  emit('select', index)
  emit('update:open', false)
}

/* ---------------- 替换单格 ---------------- */

const fileInput = ref<HTMLInputElement>()
const pendingIndex = ref(0)

function pickReplacement(index: number) {
  pendingIndex.value = index
  const input = fileInput.value
  if (!input) return
  input.value = ''
  input.click()
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const index = pendingIndex.value
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 100
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        message.error('当前浏览器不支持画布，无法替换图标')
        return
      }
      // cover：短边撑满，超出的部分裁掉，避免出现留白
      const ratio = Math.max(100 / img.width, 100 / img.height)
      const w = img.width * ratio
      const h = img.height * ratio
      ctx.drawImage(img, (100 - w) / 2, (100 - h) / 2, w, h)
      emit('update:replacements', { ...props.replacements, [index]: canvas.toDataURL('image/png') })
      message.success(`已替换第 ${index} 个图标`)
    }
    img.onerror = () => message.error('这张图读不出来，换一张试试')
    img.src = String(reader.result)
  }
  reader.readAsDataURL(file)
}

function clearReplacements() {
  emit('update:replacements', {})
}

function addRow() {
  emit('update:extraRows', props.extraRows + 1)
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Modal
    :open="open"
    :width="480"
    :footer="null"
    :mask="false"
    @cancel="close"
    @update:open="emit('update:open', $event)"
  >
    <template #title>
      <div class="g-drag-handle" @pointerdown="onDown">
        选择图标
        <span class="g-tip">按住这里可拖动</span>
      </div>
    </template>

    <template #modalRender="{ originVNode }">
      <div :style="{ transform: `translate(${offset.x}px, ${offset.y}px)` }">
        <component :is="originVNode" />
      </div>
    </template>

    <Spin :spinning="spriteLoading">
      <Alert v-if="spriteError" type="error" show-icon :message="spriteError" />

      <template v-else>
        <p class="g-hint">
          {{ editMode ? '点格子替换成自己的图' : '点格子选中图标' }}
          <span v-if="current">· 当前是第 {{ current }} 个</span>
        </p>

        <div class="g-icon-view-wrap">
          <div class="g-icon-view">
            <div
              v-for="i in totalCells"
              :key="i"
              class="g-cell"
              :class="{ 'is-current': i === current, 'is-edit': editMode }"
              :style="cellStyle(i)"
              :title="`第 ${i} 个`"
              @click="onClickCell(i)"
            />
          </div>
        </div>

        <Space class="g-actions" :size="8">
          <Button
            :type="editMode ? 'primary' : 'default'"
            :danger="editMode"
            @click="editMode = !editMode"
          >
            {{ editMode ? '完成替换' : '替换图标' }}
          </Button>
          <Button type="primary" @click="addRow">
            <GIcon icon="ant-design:plus-outlined" :size="12" />
            <span class="g-btn-text">加 10 个空图标</span>
          </Button>
          <Button v-if="replacedCount" danger type="text" @click="clearReplacements">
            撤销 {{ replacedCount }} 处替换
          </Button>
        </Space>

        <input
          ref="fileInput"
          type="file"
          accept="image/bmp,image/jpeg,image/png"
          class="g-file-input"
          @change="onFileChange"
        />
      </template>
    </Spin>
  </Modal>
</template>

<style scoped>
.g-drag-handle {
  cursor: move;
}

.g-tip {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--g-text-dim);
}

.g-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--g-text-sub);
}

.g-icon-view-wrap {
  width: 100%;
  max-width: 100%;
  overflow: auto;
}

.g-icon-view {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.g-cell {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 5px;
  cursor: pointer;
  background-repeat: no-repeat;
  background-color: var(--g-bg-soft);
  transition: all 0.15s ease;
}

.g-cell:hover {
  transform: scale(1.1);
  box-shadow: 0 0 10px var(--g-brand);
  z-index: 1;
}

.g-cell.is-edit:hover {
  box-shadow: 0 0 10px var(--g-danger);
}

.g-cell.is-current {
  box-shadow: 0 0 0 2px var(--g-brand) inset;
}

.g-actions {
  margin-top: 14px;
}

.g-file-input {
  display: none;
}

.g-btn-text {
  margin-left: 4px;
}
</style>
