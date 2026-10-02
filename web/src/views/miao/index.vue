<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Alert, Button, Popconfirm, Result, Skeleton, Tag, message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import HelpEditorPanel from './components/HelpEditorPanel.vue'
import ThemePanel from './components/ThemePanel.vue'
import BackupPanel from './components/BackupPanel.vue'
import MiaoSettingDrawer from './components/MiaoSettingDrawer.vue'
import { apiGetMiaoHelpCfg, apiSaveMiaoHelpCfg } from '@/api'
import { useBrandColor } from '@/theme/useBrandColor'
import type { MiaoHelpCfgBody, MiaoHelpGroup } from '@/types'

/**
 * 喵喵帮助配置页。
 *
 * 保存时后端要求：
 *   helpCfg  → JSON 字符串（会被 JSON.parse）
 *   helpList → JS 字面量源码（会被拼进 `export const helpList = ${helpList}`）
 *   icon     → FormData 里的文件，可选；只有真的动过图标才会带上
 * 所以整页共用一次提交，工具条上的保存按钮就是唯一入口。
 */
const { brand } = useBrandColor()

/** 首次加载，加载完才挂编辑器 */
const loading = ref(true)
const refreshing = ref(false)
const notInstalled = ref(false)
const loadError = ref('')
const saving = ref(false)
const settingOpen = ref(false)

const helpCfg = ref<MiaoHelpCfgBody>({})
const helpList = ref<MiaoHelpGroup[]>([])
const themeNames = ref<string[]>([])
const miaoVersion = ref('')
const yunzaiVersion = ref('')

const editorRef = ref<InstanceType<typeof HelpEditorPanel> | null>(null)

/**
 * 侧栏皮肤管理。
 */
const editingTheme = ref<{ theme: string; style: Record<string, any> } | null>(null)

const itemCount = computed(() =>
  helpList.value.reduce((sum, g) => sum + (Array.isArray(g.list) ? g.list.length : 0), 0),
)

async function load(isReload = false) {
  if (isReload) refreshing.value = true
  else loading.value = true
  loadError.value = ''
  try {
    const data = await apiGetMiaoHelpCfg()
    helpCfg.value = data?.helpCfg ?? {}
    helpList.value = Array.isArray(data?.helpList) ? data.helpList : []
    themeNames.value = Array.isArray(data?.themeNames) ? data.themeNames : []
    miaoVersion.value = data?.miaoVersion ?? ''
    yunzaiVersion.value = data?.yunzaiVersion ?? ''
    editorRef.value?.refreshThemeStyle()
  } catch (e: any) {
    // 未安装喵喵插件时这些路由压根没注册，拿到的是 404
    if (e?.status === 404 || e?.response?.status === 404) {
      notInstalled.value = true
    } else {
      loadError.value = e?.message || '喵喵帮助配置加载失败'
    }
  } finally {
    if (isReload) refreshing.value = false
    else loading.value = false
  }
}

/** 清掉列表里的空项，避免写出脏配置 */
function cleanList(list: MiaoHelpGroup[]): MiaoHelpGroup[] {
  return list
    .map((group) => ({
      ...group,
      group: group.group ?? '',
      list: (Array.isArray(group.list) ? group.list : []).filter(
        (item) => (item.title ?? '').trim() || (item.desc ?? '').trim(),
      ),
    }))
    .filter((group) => (group.group ?? '').trim() || group.list.length)
}

async function save() {
  saving.value = true
  try {
    let icon: File | null = null
    if (editorRef.value) {
      try {
        icon = await editorRef.value.buildIconFile()
      } catch (e: any) {
        message.error(`图标生成失败：${e?.message || e}`)
        return
      }
    }

    const fd = new FormData()
    fd.append('helpCfg', JSON.stringify(helpCfg.value))
    // JSON 本身就是合法的 JS 字面量，直接当源码用
    fd.append('helpList', JSON.stringify(cleanList(helpList.value), null, 2))
    if (icon) {
      fd.append('icon', icon, icon.name)
    }

    try {
      await apiSaveMiaoHelpCfg(fd)
    } catch {
      return
    }

    editorRef.value?.resetIconEdits()
    await load(true)
  } finally {
    saving.value = false
  }
}

async function onThemeChanged() {
  try {
    const data = await apiGetMiaoHelpCfg()
    themeNames.value = Array.isArray(data?.themeNames) ? data.themeNames : []
  } catch {
  }
  editorRef.value?.refreshThemeStyle()
}

function onPreviewTheme(payload: { theme: string; style: Record<string, any> }) {
  editingTheme.value = payload
}

onMounted(() => load())
</script>

<template>
  <div class="g-page">
    <div class="g-page-head">
      <h2 class="g-page-title">喵喵帮助</h2>
      <p class="g-page-desc">
        点帮助图上的标题、分组或任意一格就能直接改，全局设置在右上角。
      </p>
    </div>

    <Skeleton v-if="loading" active :paragraph="{ rows: 10 }" />

    <Result
      v-else-if="notInstalled"
      status="info"
      title="未检测到 miao-plugin"
      sub-title="安装喵喵插件并重启后即可在这里配置帮助图。"
    />

    <Alert v-else-if="loadError" type="error" show-icon :message="loadError" />

    <template v-else>
      <div class="g-miao-toolbar">
        <div class="g-miao-meta">
          <Tag v-if="miaoVersion" :color="brand">喵喵 {{ miaoVersion }}</Tag>
          <Tag v-if="yunzaiVersion">Yunzai {{ yunzaiVersion }}</Tag>
          <Tag>{{ helpList.length }} 个分组 / {{ itemCount }} 条命令</Tag>
        </div>

        <div class="g-miao-actions">
          <Popconfirm
            title="放弃当前未保存的修改，重新从磁盘读取？"
            ok-text="重新加载"
            cancel-text="取消"
            @confirm="load(true)"
          >
            <Button size="small" :loading="refreshing">
              <GIcon icon="ant-design:reload-outlined" :size="13" />
              <span class="g-btn-text">重新加载</span>
            </Button>
          </Popconfirm>
          <Button size="small" @click="settingOpen = true">
            <GIcon icon="ant-design:setting-outlined" :size="13" />
            <span class="g-btn-text">帮助设置</span>
          </Button>
          <Button type="primary" size="small" :loading="saving" @click="save">保存</Button>
        </div>
      </div>

      <!-- 左：帮助图本体即编辑器；右：皮肤管理侧栏。窄屏自动叠成一列 -->
      <div class="g-miao-main">
        <div class="g-miao-col">
          <HelpEditorPanel
            ref="editorRef"
            :cfg="helpCfg"
            :list="helpList"
            :miao-version="miaoVersion"
            :yunzai-version="yunzaiVersion"
            :editing="editingTheme"
          />
        </div>

        <div class="g-miao-col g-miao-aside">
          <ThemePanel
            :bg-blur="helpCfg.bgBlur"
            @changed="onThemeChanged"
            @preview="onPreviewTheme"
          />
        </div>
      </div>

      <BackupPanel @restored="load(true)" />

      <MiaoSettingDrawer v-model:open="settingOpen" :cfg="helpCfg" :theme-names="themeNames" />
    </template>
  </div>
</template>

<style scoped>
/* 浮在内容上方的工具条：页面拉长以后保存按钮也够得着 */
.g-miao-toolbar {
  position: sticky;
  top: 12px;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: var(--g-bg-card);
  border: 1px solid var(--g-border);
  border-radius: 10px;
  box-shadow: var(--g-shadow);
}

.g-miao-meta,
.g-miao-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.g-btn-text {
  margin-left: 4px;
}

.g-page {
  container-type: inline-size;
}

.g-miao-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
}

@container (min-width: 1024px) {
  .g-miao-main {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
}

.g-miao-col {
  min-width: 0;
}

.g-miao-col > :deep(.ant-card) {
  margin-bottom: 0;
}

.g-miao-aside {
  position: sticky;
  top: 70px;
  max-height: calc(100vh - 82px);
  overflow-y: auto;
  overflow-x: hidden;
}

@container (max-width: 1023.98px) {
  .g-miao-aside {
    position: static;
    max-height: none;
    overflow: visible;
  }
}
</style>
