<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  Button,
  Card,
  Col,
  Popconfirm,
  Row,
  Slider,
  Tag,
  Upload,
  message,
} from 'ant-design-vue'
import GColorPicker from '@/components/schema-form/components/GColorPicker.vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { apiGetTheme, apiUploadThemeBackground } from '@/api'
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  FONT_RANGE,
  IMG_ACCEPT,
  RADIUS_RANGE,
  type ThemeMode,
  type ThemeSettings,
} from '@/theme/config'
import { API_BASE } from '@/utils/env'

const appStore = useAppStore()
const auth = useAuthStore()

/**
 * 页面草稿。所有改动即时预览
 */
const draft = reactive<ThemeSettings>(cloneTheme(appStore.saved))

function cloneTheme(source: ThemeSettings): ThemeSettings {
  return { ...source, backgrounds: { ...source.backgrounds } }
}

function syncDraft(source: ThemeSettings) {
  Object.assign(draft, cloneTheme(source))
}

watch(draft, () => appStore.previewTheme(draft))

const saving = ref(false)
const dirty = computed(() => appStore.isDirty)

const presets = [
  { color: '#d19f56', name: '暖金' },
  { color: '#5f7a6b', name: '灰绿' },
  { color: '#3f7fb5', name: '天青' },
  { color: '#2f9e8f', name: '青碧' },
  { color: '#8b6bb1', name: '藕紫' },
  { color: '#c9564f', name: '绯红' },
  { color: '#d4793a', name: '蜜橙' },
  { color: '#6b7280', name: '石墨' },
]

/* ---------------- 自定义背景 ---------------- */

const MODES: Array<{ key: ThemeMode; label: string }> = [
  { key: 'dark', label: '深色' },
  { key: 'light', label: '浅色' },
]

const uploading = ref<ThemeMode | ''>('')
const imgTs = ref(Date.now())

const bgEnabled = computed(() => draft.themeId === 'glass')

function bgUrl(mode: ThemeMode) {
  const name = draft.backgrounds[mode]
  if (!name) return ''
  const q = new URLSearchParams({
    name,
    token: auth.liteToken || auth.token,
    _t: String(imgTs.value),
  })
  return `${API_BASE}/theme/background/image?${q.toString()}`
}

async function uploadBg(mode: ThemeMode, file: File) {
  if (!bgEnabled.value) return false
  uploading.value = mode
  try {
    const fd = new FormData()
    fd.append('mode', mode)
    fd.append('file', file, file.name)
    const { name } = await apiUploadThemeBackground(fd)
    if (name) draft.backgrounds[mode] = name
    message.success('已上传，点「保存」生效')
  } catch {
  } finally {
    uploading.value = ''
  }
  return false
}

function removeBg(mode: ThemeMode) {
  draft.backgrounds[mode] = ''
}

const imgRetried = ref(false)
async function onImgError() {
  if (imgRetried.value) return
  imgRetried.value = true
  await auth.refreshLiteToken()
  imgTs.value = Date.now()
}

/* ---------------- 保存 / 撤回 ---------------- */

async function onSave() {
  saving.value = true
  try {
    syncDraft(await appStore.saveCurrent(draft))
    message.success('已保存')
  } catch {
  } finally {
    saving.value = false
  }
}

function onRevert() {
  appStore.revert()
  syncDraft(appStore.saved)
}

function onResetDefault() {
  syncDraft(DEFAULT_THEME)
}

onMounted(async () => {
  try {
    appStore.applySaved(await apiGetTheme())
  } catch {
  }
  syncDraft(appStore.saved)
  await auth.refreshLiteToken()
  imgTs.value = Date.now()
})

onUnmounted(() => {
  appStore.revert()
})
</script>

<template>
  <div class="g-page">
    <div class="g-page-head">
      <h2 class="g-page-title">外观设置</h2>
      <p class="g-page-desc">
        面板整体外观配置。
      </p>
    </div>

    <Row :gutter="[16, 16]">
      <Col :xs="24" :lg="12">
        <Card :bordered="false" title="主色调" class="g-block">
          <div class="g-presets">
            <button
              v-for="preset in presets"
              :key="preset.color"
              type="button"
              class="g-swatch"
              :class="{ 'is-active': draft.primaryColor === preset.color }"
              :style="{ background: preset.color }"
              :title="preset.name"
              @click="draft.primaryColor = preset.color"
            />
          </div>

          <div class="g-color-row">
            <GColorPicker v-model:value="draft.primaryColor" placeholder="留空用默认色，如 #3f7fb5" />
            <Button type="link" size="small" @click="draft.primaryColor = ''">用默认色</Button>
          </div>

          <p class="g-hint">
            当前生效
            <span class="g-dot" :style="{ background: appStore.effectivePrimary }" />
            <span class="g-selectable">{{ appStore.effectivePrimary }}</span>
            <template v-if="!draft.primaryColor">（内置默认：深色暖金 / 浅色灰绿）</template>
          </p>
          <p class="g-hint">
            深色与浅色共用这一个主色，按钮、菜单选中态、柔光与前景字色都会跟着推导出来。
          </p>
        </Card>
      </Col>

      <Col :xs="24" :lg="12">
        <Card :bordered="false" title="圆角与字号" class="g-block">
          <div class="g-field">
            <span class="g-field-label">组件圆角</span>
            <Slider
              v-model:value="draft.borderRadius"
              class="g-field-slider"
              :min="RADIUS_RANGE.min"
              :max="RADIUS_RANGE.max"
              :step="1"
            />
            <span class="g-field-val">{{ draft.borderRadius }}px</span>
          </div>
          <div class="g-field">
            <span class="g-field-label">基础字号</span>
            <Slider
              v-model:value="draft.fontSize"
              class="g-field-slider"
              :min="FONT_RANGE.min"
              :max="FONT_RANGE.max"
              :step="1"
            />
            <span class="g-field-val">{{ draft.fontSize }}px</span>
          </div>
          <p class="g-hint">作用于 antd 组件：按钮、输入框、卡片、弹窗、表格等。</p>
        </Card>
      </Col>
    </Row>

    <Card :bordered="false" class="g-block">
      <template #title>内置主题</template>
      <template #extra>
        <span class="g-hint">配背景图时「毛玻璃」更出效果</span>
      </template>

      <div class="g-themes">
        <button
          v-for="t in BUILTIN_THEMES"
          :key="t.id"
          type="button"
          class="g-theme"
          :class="{ 'is-active': draft.themeId === t.id }"
          @click="draft.themeId = t.id"
        >
          <span class="g-theme-name">{{ t.name }}</span>
          <span class="g-theme-hint">{{ t.hint }}</span>
        </button>
      </div>
    </Card>

    <Card :bordered="false" class="g-block">
      <template #title>自定义背景</template>
      <template #extra>
        <Button v-if="!bgEnabled" type="link" size="small" @click="draft.themeId = 'glass'">
          切换到毛玻璃
        </Button>
        <span v-else class="g-hint">铺满整块面板，深浅各一张</span>
      </template>

      <Row :gutter="[24, 8]">
        <Col v-for="m in MODES" :key="m.key" :xs="24" :lg="12">
          <div class="g-bg-col">
            <div class="g-bg-head">
              <span class="g-bg-title">{{ m.label }}</span>
              <Tag v-if="appStore.mode === m.key" color="blue">当前</Tag>
            </div>

            <div class="g-bg-box" :class="{ 'is-off': !bgEnabled }">
              <Upload
                class="g-bg-upload"
                :before-upload="(f: File) => uploadBg(m.key, f)"
                :show-upload-list="false"
                :accept="IMG_ACCEPT"
                :disabled="!bgEnabled || uploading === m.key"
              >
                <div class="g-bg-preview" :class="{ 'is-empty': !draft.backgrounds[m.key] }">
                  <img
                    v-if="draft.backgrounds[m.key]"
                    :src="bgUrl(m.key)"
                    alt=""
                    @error="onImgError"
                  />
                  <span v-else class="g-bg-empty">还没有背景图</span>
                  <span v-if="bgEnabled" class="g-bg-mask">
                    {{
                      uploading === m.key
                        ? '上传中…'
                        : draft.backgrounds[m.key]
                          ? '点击更换图片'
                          : '点击上传图片'
                    }}
                  </span>
                </div>
              </Upload>

              <button
                v-if="draft.backgrounds[m.key]"
                type="button"
                class="g-bg-remove"
                :disabled="!bgEnabled"
                title="移除这张背景"
                @click="removeBg(m.key)"
              >
                <GIcon icon="ant-design:close-outlined" :size="12" />
              </button>
            </div>
          </div>
        </Col>
      </Row>

      <p class="g-hint">
        背景图只在<strong>「毛玻璃」主题</strong>下生效。图片存到 <code>config/theme/</code>。
      </p>
    </Card>

    <div class="g-actions">
      <span v-if="dirty" class="g-dirty">有改动未保存</span>
      <span v-else class="g-saved">已是最新</span>
      <div class="g-actions-btns">
        <Button :disabled="!dirty" @click="onRevert">撤回</Button>
        <Popconfirm
          title="恢复默认外观？"
          description="主色、圆角字号、内置主题和两张背景图都会回到内置默认"
          ok-text="恢复"
          cancel-text="取消"
          @confirm="onResetDefault"
        >
          <Button>恢复默认</Button>
        </Popconfirm>
        <Button type="primary" :loading="saving" :disabled="!dirty" @click="onSave">保存</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.g-page-head {
  margin-bottom: 14px;
}

.g-block {
  margin-bottom: 16px;
}

/* ---------------- 内置主题 ---------------- */

.g-themes {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.g-theme {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  text-align: left;
  background: transparent;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.g-theme:hover {
  border-color: var(--g-brand);
}

.g-theme.is-active {
  border-color: var(--g-brand);
  background: var(--g-brand-soft);
}

.g-theme-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text);
}

.g-theme-hint {
  font-size: 11px;
  line-height: 1.5;
  color: var(--g-text-dim);
}

/* ---------------- 自定义背景 ---------------- */

.g-bg-col + .g-bg-col {
  border-left: 1px solid var(--g-border);
}

@media (max-width: 992px) {
  .g-bg-col + .g-bg-col {
    padding-top: 14px;
    border-left: none;
    border-top: 1px solid var(--g-border);
  }
}

.g-bg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.g-bg-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text);
}

.g-bg-box {
  position: relative;
}

.g-bg-box :deep(.ant-upload-wrapper),
.g-bg-box :deep(.ant-upload) {
  display: block;
  width: 100%;
}

.g-bg-box :deep(.ant-upload) {
  cursor: pointer;
}

.g-bg-box.is-off :deep(.ant-upload) {
  cursor: not-allowed;
  pointer-events: none;
}

.g-bg-preview {
  position: relative;
  height: 108px;
  overflow: hidden;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}

.g-bg-box:not(.is-off) .g-bg-preview:hover {
  border-color: var(--g-brand);
}

.g-bg-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.g-bg-preview.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
}

.g-bg-empty {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-bg-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.42);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.g-bg-preview:hover .g-bg-mask {
  opacity: 1;
}

.g-bg-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease;
}

.g-bg-remove:hover:not(:disabled) {
  background: var(--g-danger);
}

.g-bg-remove:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.g-bg-box.is-off .g-bg-preview {
  opacity: 0.5;
}

/* ---------------- 主色调 ---------------- */

.g-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.g-swatch {
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.g-swatch:hover {
  transform: scale(1.08);
}

.g-swatch.is-active {
  outline: 2px solid var(--g-brand);
  outline-offset: 2px;
}

.g-color-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.g-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin: 0 5px;
  border-radius: 3px;
  vertical-align: -1px;
}

/* ---------------- 圆角字号 ---------------- */

.g-field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.g-field-label {
  flex-shrink: 0;
  width: 64px;
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-field-slider {
  flex: 1;
  min-width: 0;
}

.g-field-val {
  flex-shrink: 0;
  width: 46px;
  font-size: 13px;
  color: var(--g-text);
  text-align: right;
}

.g-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--g-text-dim);
}

.g-hint code {
  padding: 0 4px;
  background: var(--g-brand-soft);
  border-radius: 4px;
}

/* ---------------- 底部操作条 ---------------- */

/* 操作条是本页最后一块。flex + min-height 把它压到底：内容比内容区矮时
   sticky 没有可贴的滚动距离，会停在半空 */
.g-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding-bottom: 0;
}

.g-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: auto -20px 0;
  padding: 12px 20px;
  background: var(--g-bg);
}

.g-dirty {
  font-size: 13px;
  color: var(--g-brand);
}

.g-saved {
  font-size: 13px;
  color: var(--g-text-dim);
}

.g-actions-btns {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .g-actions {
    margin: auto -12px 0;
    padding: 12px;
  }

  .g-dirty,
  .g-saved {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .g-actions-btns {
    flex-shrink: 0;
  }
}
</style>
