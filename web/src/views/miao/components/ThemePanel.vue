<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import GColorPicker from '@/components/schema-form/components/GColorPicker.vue'
import {
  apiAddMiaoTheme,
  apiDeleteMiaoTheme,
  apiGetMiaoThemeList,
  apiPutMiaoTheme,
  apiSaveMiaoThemeConfig,
  miaoThemeMainUrl,
} from '@/api'
import { useAuthStore } from '@/stores/auth'
import { structuredCloneSafe } from '@/utils/schema'
import type { MiaoThemeItem } from '@/types'

/**
 * 皮肤管理。
 *
 * 一个皮肤就是 miao-plugin/resources/help/theme/<name>/ 目录，
 * 里面必须有 main.png（底图），可选 config.js（配色覆盖）。
 * default 皮肤不允许修改或删除。
 */
const emit = defineEmits<{
  changed: []
  preview: [payload: { theme: string; style: Record<string, any> }]
}>()

const auth = useAuthStore()

const loading = ref(true)
const themes = ref<MiaoThemeItem[]>([])
const selected = ref('')
const imgTs = ref(Date.now())

const savingConfig = ref(false)
const styleDraft = ref<Record<string, any>>({})

const addOpen = ref(false)
const addName = ref('')
const addFile = ref<File | null>(null)
const adding = ref(false)

const replacing = ref(false)

/**
 * 图片加载失败自处理：liteToken 会随服务重启失效，旧页面拿旧 token 请求图片会 401 裂图。
 * 失败时刷新一次 liteToken 再 bump 时间戳重载；只重试一次，避免死循环。
 */
const imgRetried = ref(false)
async function onImgError() {
  if (imgRetried.value) return
  imgRetried.value = true
  await auth.refreshLiteToken()
  imgTs.value = Date.now()
}

const current = computed(() => themes.value.find((t) => t.name === selected.value))
const isDefault = computed(() => selected.value === 'default')

// 侧栏窄，标签用短名，完整说法放 tooltip
const styleFields = [
  { key: 'fontColor', label: '标题色', hint: '标题字体色' },
  { key: 'descColor', label: '描述色', hint: '描述字体色' },
  { key: 'contBgColor', label: '内容底', hint: '内容背景色' },
  { key: 'headerBgColor', label: '头部底', hint: '头部背景色' },
  { key: 'rowBgColor1', label: '奇数行', hint: '奇数行背景色' },
  { key: 'rowBgColor2', label: '偶数行', hint: '偶数行背景色' },
]

function mainUrl(name: string) {
  return miaoThemeMainUrl(name, auth.liteToken || auth.token, imgTs.value)
}

async function load(keepSelection = true) {
  loading.value = true
  try {
    const list = await apiGetMiaoThemeList()
    themes.value = Array.isArray(list) ? list : []
    if (!keepSelection || !themes.value.some((t) => t.name === selected.value)) {
      selected.value = themes.value[0]?.name ?? ''
    }
    syncDraft()
  } catch {
    themes.value = []
  } finally {
    loading.value = false
  }
}

function syncDraft() {
  styleDraft.value = structuredCloneSafe(current.value?.style ?? {})
}

function select(name: string) {
  selected.value = name
  syncDraft()
}

/**
 * 用深监听：配色输入框是直接改 styleDraft[key] 的，不走 select()。
 */
watch(
  [selected, styleDraft],
  () => {
    if (!selected.value) return
    emit('preview', { theme: selected.value, style: { ...styleDraft.value } })
  },
  { deep: true, immediate: true },
)

async function saveConfig() {
  if (isDefault.value) {
    message.warning('默认皮肤不可修改')
    return
  }
  savingConfig.value = true
  try {
    await apiSaveMiaoThemeConfig(selected.value, styleDraft.value)
    await load()
    // 配色变了，左边帮助图要重新取一次主题 config 才能看到效果
    emit('changed')
  } finally {
    savingConfig.value = false
  }
}

function beforeAddFile(file: File) {
  if (!/\.png$/i.test(file.name)) {
    message.warning('底图需要是 png 格式')
    return false
  }
  addFile.value = file
  return false
}

async function doAdd() {
  const name = addName.value.trim()
  if (!name) {
    message.warning('请填写皮肤名称')
    return
  }
  if (!/^[\w一-龥-]+$/.test(name)) {
    message.warning('皮肤名只能包含中英文、数字、下划线和短横线')
    return
  }
  if (themes.value.some((t) => t.name === name)) {
    message.warning('该皮肤已存在')
    return
  }
  if (!addFile.value) {
    message.warning('请选择底图 main.png')
    return
  }

  adding.value = true
  try {
    const fd = new FormData()
    fd.append('themeName', name)
    fd.append('file', addFile.value, 'main.png')
    await apiAddMiaoTheme(fd)
    addOpen.value = false
    addName.value = ''
    addFile.value = null
    imgTs.value = Date.now()
    await load(false)
    selected.value = name
    syncDraft()
    emit('changed')
  } finally {
    adding.value = false
  }
}

async function replaceMain(file: File) {
  if (isDefault.value) {
    message.warning('默认皮肤不可修改')
    return false
  }
  if (!/\.png$/i.test(file.name)) {
    message.warning('底图需要是 png 格式')
    return false
  }
  replacing.value = true
  try {
    const fd = new FormData()
    fd.append('themeName', selected.value)
    fd.append('file', file, 'main.png')
    await apiPutMiaoTheme(fd)
    // 换图后 URL 不变，加时间戳强制刷新缓存
    imgTs.value = Date.now()
    emit('changed')
  } finally {
    replacing.value = false
  }
  return false
}

async function removeTheme(name: string) {
  await apiDeleteMiaoTheme(name)
  await load(false)
  emit('changed')
}

onMounted(() => load(false))
</script>

<template>
  <Card :bordered="false" class="g-miao-card">
    <template #title><span class="g-miao-title">皮肤管理</span></template>
    <template #extra>
      <Space :size="6">
        <Tooltip title="新增皮肤">
          <Button size="small" @click="addOpen = true">
            <GIcon icon="ant-design:plus-outlined" :size="12" />
          </Button>
        </Tooltip>
        <Tooltip title="重新读取皮肤列表">
          <Button size="small" :loading="loading" @click="load()">
            <GIcon icon="ant-design:reload-outlined" :size="13" />
          </Button>
        </Tooltip>
      </Space>
    </template>

    <Skeleton v-if="loading && !themes.length" active :paragraph="{ rows: 5 }" />

    <Empty v-else-if="!themes.length" description="没有找到任何皮肤" />

    <template v-else>
      <div class="g-theme-list">
        <div
          v-for="t in themes"
          :key="t.name"
          class="g-theme-item"
          :class="{ 'is-active': t.name === selected }"
          @click="select(t.name)"
        >
          <img :src="mainUrl(t.name)" alt="" class="g-theme-thumb" @error="onImgError" />
          <div class="g-theme-info">
            <span class="g-theme-name">{{ t.name }}</span>
            <Tag v-if="t.name === 'default'" color="blue">默认</Tag>
          </div>
          <Popconfirm
            v-if="t.name !== 'default'"
            title="删除该皮肤目录？此操作不可恢复"
            ok-text="删除"
            cancel-text="取消"
            @confirm="removeTheme(t.name)"
          >
            <Button type="text" danger size="small" @click.stop>
              <GIcon icon="ant-design:delete-outlined" :size="12" />
            </Button>
          </Popconfirm>
        </div>
      </div>

      <template v-if="current">
        <Alert
          v-if="isDefault"
          type="info"
          show-icon
          class="g-theme-alert"
          message="默认皮肤不可修改或删除"
          description="想调整配色，请新增一个皮肤后再改。"
        />

        <div class="g-theme-preview">
          <img :src="mainUrl(current.name)" alt="" class="g-theme-main" @error="onImgError" />
          <div v-if="!isDefault" class="g-theme-replace-slot">
            <Upload :before-upload="replaceMain" :show-upload-list="false" accept="image/png">
              <Button size="small" :loading="replacing">
                <GIcon icon="ant-design:picture-outlined" :size="12" />
                <span class="g-btn-text">更换底图</span>
              </Button>
            </Upload>
          </div>
        </div>

        <div class="g-theme-colors">
          <div v-for="f in styleFields" :key="f.key" class="g-color-row">
            <Tooltip :title="f.hint" placement="left">
              <span class="g-color-label">{{ f.label }}</span>
            </Tooltip>
            <div class="g-color-field">
              <GColorPicker v-model:value="styleDraft[f.key]" :disabled="isDefault" />
            </div>
          </div>
        </div>

        <Space :size="8" class="g-theme-actions">
          <Button
            type="primary"
            size="small"
            :loading="savingConfig"
            :disabled="isDefault"
            @click="saveConfig"
          >
            保存配色
          </Button>
          <Button size="small" :disabled="isDefault" @click="syncDraft">重置</Button>
        </Space>
      </template>
    </template>

    <Modal
      v-model:open="addOpen"
      title="新增皮肤"
      ok-text="创建"
      cancel-text="取消"
      :confirm-loading="adding"
      @ok="doAdd"
    >
      <Form layout="vertical">
        <FormItem label="皮肤名称" extra="将作为 resources/help/theme 下的目录名">
          <Input v-model:value="addName" placeholder="例如 mytheme" allowClear />
        </FormItem>
        <FormItem label="底图（main.png）">
          <Upload :before-upload="beforeAddFile" :show-upload-list="false" accept="image/png">
            <Button>
              <GIcon icon="ant-design:upload-outlined" :size="13" />
              <span class="g-btn-text">选择图片</span>
            </Button>
          </Upload>
          <p v-if="addFile" class="g-file-name">已选择：{{ addFile.name }}</p>
        </FormItem>
      </Form>
    </Modal>
  </Card>
</template>

<style scoped>
.g-miao-card {
  margin-bottom: 0;
}

.g-miao-title {
  font-size: 15px;
  font-weight: 600;
}

/* 列表限高 */
.g-theme-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 168px;
  overflow: auto;
  margin-bottom: 12px;
}

.g-theme-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.g-theme-item:hover {
  border-color: var(--g-brand);
}

.g-theme-item.is-active {
  border-color: var(--g-brand);
  background: var(--g-brand-soft);
}

.g-theme-thumb {
  width: 48px;
  height: 30px;
  flex-shrink: 0;
  object-fit: cover;
  object-position: top;
  border-radius: 4px;
  background: var(--g-bg-soft);
}

.g-theme-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.g-theme-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.g-theme-alert {
  margin-bottom: 10px;
}

.g-theme-alert :deep(.ant-alert-description) {
  font-size: 12px;
}

.g-theme-preview {
  position: relative;
  margin-bottom: 12px;
}

.g-theme-main {
  display: block;
  width: 100%;
  max-height: 148px;
  object-fit: cover;
  object-position: top;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  background: var(--g-bg-soft);
}

.g-theme-replace-slot {
  position: absolute;
  right: 8px;
  bottom: 8px;
}

.g-theme-colors {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.g-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.g-color-label {
  flex: 0 0 52px;
  font-size: 12px;
  color: var(--g-text-dim);
  text-align: right;
  white-space: nowrap;
}

.g-color-field {
  flex: 1;
  min-width: 0;
}

.g-color-field :deep(.g-color) {
  max-width: none;
  width: 100%;
}

.g-theme-actions {
  display: flex;
}

.g-file-name {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-btn-text {
  margin-left: 5px;
}
</style>
