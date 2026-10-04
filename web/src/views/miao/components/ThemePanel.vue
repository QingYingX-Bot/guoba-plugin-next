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
  InputNumber,
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
  miaoThemeBgUrl,
  miaoThemeMainUrl,
} from '@/api'
import { useAuthStore } from '@/stores/auth'
import { structuredCloneSafe } from '@/utils/schema'
import type { MiaoThemeItem } from '@/types'

/**
 * 皮肤管理。
 *
 * 一个皮肤就是 miao-plugin/resources/help/theme/<name>/ 目录：
 *   main.png   头图（必需，没有它这个目录根本不会被 HelpTheme 认成皮肤）
 *   bg.jpg     背景底图（可选，缺了回落到 default/bg.jpg）
 *   config.js  style 对象
 * default 皮肤不允许修改或删除。
 */
const props = defineProps<{
  /** helpCfg.bgBlur —— 关掉时 HelpTheme 直接输出 backdrop-filter:none，毛玻璃那一项就没意义了 */
  bgBlur?: boolean
}>()

const emit = defineEmits<{
  changed: []
  preview: [payload: { theme: string; style: Record<string, any> }]
}>()

const auth = useAuthStore()
const IMG_ACCEPT = '.png,.jpg,.jpeg,.jpe,.webp,.gif,.avif'

const loading = ref(true)
const themes = ref<MiaoThemeItem[]>([])
const selected = ref('')
const imgTs = ref(Date.now())

const savingConfig = ref(false)
const styleDraft = ref<Record<string, any>>({})

const addOpen = ref(false)
const addName = ref('')
const addFile = ref<File | null>(null)
const addBgFile = ref<File | null>(null)
const adding = ref(false)

const replacing = ref<'' | 'main' | 'bg'>('')

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
  { key: 'fontColor', label: '标题色', type: 'color', hint: '标题字体色（.help-title / .help-group）' },
  { key: 'fontShadow', label: '标题影', type: 'text', hint: '标题文字阴影，CSS text-shadow，如 0px 0px 1px rgba(6,21,31,.9)；none 为不投影' },
  { key: 'descColor', label: '描述色', type: 'color', hint: '描述字体色（.help-desc）' },
  { key: 'descShadow', label: '描述影', type: 'text', hint: '描述文字阴影，CSS text-shadow；none 为不投影' },
  { key: 'contBgColor', label: '内容底', type: 'color', hint: '面板整体底色（.cont-box），叠在标题栏和帮助行之下' },
  { key: 'contBgBlur', label: '毛玻璃', type: 'number', hint: '面板底图毛玻璃模糊半径 0-10；「帮助设置」里关掉 bgBlur 时这项不生效' },
  { key: 'headerBgColor', label: '头部底', type: 'color', hint: '板块标题栏底色（.help-group）' },
  { key: 'rowBgColor1', label: '奇数行', type: 'color', hint: '帮助表奇数行底色' },
  { key: 'rowBgColor2', label: '偶数行', type: 'color', hint: '帮助表偶数行底色' },
]

const STYLE_DEFAULTS: Record<string, any> = {
  fontColor: '#ceb78b',
  fontShadow: 'none',
  descColor: '#eee',
  descShadow: 'none',
  contBgColor: 'rgba(43, 52, 61, 0.8)',
  contBgBlur: 3,
  headerBgColor: 'rgba(34, 41, 51, .4)',
  rowBgColor1: 'rgba(34, 41, 51, .2)',
  rowBgColor2: 'rgba(34, 41, 51, .4)',
}

const blurDisabled = computed(() => props.bgBlur === false)

function mainUrl(name: string) {
  return miaoThemeMainUrl(name, auth.liteToken || auth.token, imgTs.value)
}

function bgUrl(name: string) {
  return miaoThemeBgUrl(name, auth.liteToken || auth.token, imgTs.value)
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
  let draft: Record<string, any> = structuredCloneSafe(current.value?.style ?? {})
  for (let f of styleFields) {
    if (draft[f.key] === undefined) {
      draft[f.key] = STYLE_DEFAULTS[f.key]
    }
  }
  styleDraft.value = draft
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

function beforeAddFile(file: File, target: 'main' | 'bg') {
  if (target === 'bg') {
    addBgFile.value = file
  } else {
    addFile.value = file
  }
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
    message.warning('请选择头图 main.png')
    return
  }

  adding.value = true
  try {
    const fd = new FormData()
    fd.append('themeName', name)
    fd.append('main', addFile.value, 'main.png')
    if (addBgFile.value) {
      fd.append('bg', addBgFile.value, 'bg.jpg')
    }
    await apiAddMiaoTheme(fd)
    addOpen.value = false
    addName.value = ''
    addFile.value = null
    addBgFile.value = null
    imgTs.value = Date.now()
    await load(false)
    selected.value = name
    syncDraft()
    emit('changed')
  } finally {
    adding.value = false
  }
}

async function replaceImage(file: File, target: 'main' | 'bg') {
  if (isDefault.value) {
    message.warning('默认皮肤不可修改')
    return false
  }
  replacing.value = target
  try {
    const fd = new FormData()
    fd.append('themeName', selected.value)
    fd.append(target, file, target === 'bg' ? 'bg.jpg' : 'main.png')
    await apiPutMiaoTheme(fd)
    // 换图后 URL 不变，加时间戳强制刷新缓存
    imgTs.value = Date.now()
    await load()
    emit('changed')
  } finally {
    replacing.value = ''
  }
  return false
}

async function resetBg() {
  const fd = new FormData()
  fd.append('themeName', selected.value)
  fd.append('resetBg', '1')
  await apiPutMiaoTheme(fd)
  imgTs.value = Date.now()
  await load()
  emit('changed')
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

        <!-- 一个皮肤两张图：头图铺在 .container 上，背景铺在 body 上并平铺 -->
        <div class="g-theme-images">
          <div class="g-theme-imgbox">
            <img :src="mainUrl(current.name)" alt="" class="g-theme-main" @error="onImgError" />
            <span class="g-theme-imgtag">头图 main.png</span>
            <div v-if="!isDefault" class="g-theme-replace-slot">
              <Upload
                :before-upload="(f: File) => replaceImage(f, 'main')"
                :show-upload-list="false"
                :accept="IMG_ACCEPT"
              >
                <Button size="small" :loading="replacing === 'main'">
                  <GIcon icon="ant-design:picture-outlined" :size="12" />
                  <span class="g-btn-text">更换头图</span>
                </Button>
              </Upload>
            </div>
          </div>

          <div class="g-theme-imgbox is-bg">
            <img :src="bgUrl(current.name)" alt="" class="g-theme-bg" @error="onImgError" />
            <span class="g-theme-imgtag">
              背景 bg.jpg
              <em v-if="!current.hasBg" class="g-theme-fallback">沿用 default</em>
            </span>
            <div v-if="!isDefault" class="g-theme-replace-slot">
              <Upload
                :before-upload="(f: File) => replaceImage(f, 'bg')"
                :show-upload-list="false"
                :accept="IMG_ACCEPT"
              >
                <Button size="small" :loading="replacing === 'bg'">
                  <GIcon icon="ant-design:bg-colors-outlined" :size="12" />
                  <span class="g-btn-text">更换背景</span>
                </Button>
              </Upload>
              <Popconfirm
                v-if="current.hasBg"
                title="删掉这张背景，回落到 default 的 bg.jpg？"
                ok-text="恢复"
                cancel-text="取消"
                @confirm="resetBg"
              >
                <Tooltip title="删掉自定义背景，回到 default">
                  <Button size="small">
                    <GIcon icon="ant-design:undo-outlined" :size="12" />
                  </Button>
                </Tooltip>
              </Popconfirm>
            </div>
          </div>
        </div>

        <div class="g-theme-colors">
          <div v-for="f in styleFields" :key="f.key" class="g-color-row">
            <Tooltip :title="f.hint" placement="left">
              <span class="g-color-label">{{ f.label }}</span>
            </Tooltip>
            <div class="g-color-field">
              <GColorPicker
                v-if="f.type === 'color'"
                v-model:value="styleDraft[f.key]"
                :disabled="isDefault"
              />
              <InputNumber
                v-else-if="f.type === 'number'"
                v-model:value="styleDraft[f.key]"
                :min="0"
                :max="10"
                :step="0.5"
                :disabled="isDefault || blurDisabled"
                class="g-blur-input"
              />
              <Input v-else v-model:value="styleDraft[f.key]" :disabled="isDefault" placeholder="none" />
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
        <FormItem label="头图（main.png）" extra="必需。铺在帮助图容器上，也是这个皮肤被识别的凭据">
          <Upload
            :before-upload="(f: File) => beforeAddFile(f, 'main')"
            :show-upload-list="false"
            :accept="IMG_ACCEPT"
          >
            <Button>
              <GIcon icon="ant-design:upload-outlined" :size="13" />
              <span class="g-btn-text">选择图片</span>
            </Button>
          </Upload>
          <p v-if="addFile" class="g-file-name">已选择：{{ addFile.name }}</p>
        </FormItem>
        <FormItem label="背景底图（bg.jpg）" extra="可选。铺在整页背景上并平铺；不传就沿用 default 的">
          <Upload
            :before-upload="(f: File) => beforeAddFile(f, 'bg')"
            :show-upload-list="false"
            :accept="IMG_ACCEPT"
          >
            <Button>
              <GIcon icon="ant-design:upload-outlined" :size="13" />
              <span class="g-btn-text">选择图片</span>
            </Button>
          </Upload>
          <p v-if="addBgFile" class="g-file-name">已选择：{{ addBgFile.name }}</p>
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

.g-theme-images {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.g-theme-imgbox {
  position: relative;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--g-bg-soft);
}

.g-theme-main {
  display: block;
  width: 100%;
  height: 120px;
  object-fit: cover;
  object-position: top;
}

.g-theme-bg {
  display: block;
  width: 100%;
  height: 64px;
  object-fit: none;
  object-position: 0 0;
}

.g-theme-imgtag {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.g-theme-fallback {
  font-style: normal;
  opacity: 0.75;
}

.g-theme-replace-slot {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.g-blur-input {
  width: 100%;
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
