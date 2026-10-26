<script setup lang="ts">
/**
 * 文件管理 · 手机视图。
 *
 * 表格在手机上要横着拖才能看到「操作」列，勾选和删除都够不着，所以窄屏换成卡片：
 * 一行一个条目，名字 + 一行元信息，右侧「⋯」收菜单。勾选多选模式后卡片只负责选，
 * 底部弹出一条吸底的批量操作条。逻辑全在 useFileManager，这里只管怎么摆。
 */
import GIcon from '@/components/GIcon.vue'
import type { FsFile } from '@/api'
import type { FileManager } from '../useFileManager'

const props = defineProps<{ vm: FileManager }>()

/** 上传用的 input 只有一份，放在父页面；这里只负责喊一声 */
defineEmits<{
  (e: 'pick-upload'): void
  (e: 'pick-upload-dir'): void
}>()

function onCardClick(f: FsFile) {
  if (props.vm.selectMode) props.vm.toggleSelect(f)
  else void props.vm.onOpen(f)
}

/** 卡片副标题：文件给「大小 · 时间」，文件夹给算过的占用（没算过就只写文件夹） */
function cardMeta(f: FsFile) {
  if (!f.isDir) return `${props.vm.fmtSize(f.size)} · ${props.vm.fmtTime(f.mtime)}`
  const d = props.vm.dirSizes[props.vm.joinPath(f.name)]
  if (d?.loading) return '文件夹 · 正在计算…'
  const text = props.vm.dirSizeText(f)
  return text ? `文件夹 · ${text}` : '文件夹'
}

function onCardMenuClick(info: { key: string | number }, f: FsFile) {
  const key = String(info.key)
  if (key === 'open') void props.vm.onOpen(f)
  else if (key === 'edit') void props.vm.onEdit(f)
  else if (key === 'size') void props.vm.calcSize(f)
  else if (key === 'download') props.vm.triggerDownload(props.vm.downloadUrl(f))
  else if (key === 'rename') props.vm.openRename(f)
  else if (key === 'delete') props.vm.confirmDelete(f)
}
</script>

<template>
  <div class="g-files-bar">
    <div class="g-files-crumb">
      <!-- 路径一深，面包屑得横向拖，给一个固定的「上一级」少拖一次 -->
      <button
        v-if="vm.currentPath"
        type="button"
        class="g-files-crumb-btn is-back"
        title="返回上一级"
        @click="vm.goBreadcrumb(vm.parentPath)"
      >
        <GIcon icon="ant-design:left-outlined" :size="12" />
      </button>
      <button type="button" class="g-files-crumb-btn is-root" @click="vm.goBreadcrumb('')">
        <GIcon icon="ant-design:home-outlined" :size="12" />
        Yunzai
      </button>
      <template v-for="cr in vm.breadcrumbs" :key="cr.path">
        <GIcon icon="ant-design:right-outlined" :size="11" class="g-files-sep" />
        <button type="button" class="g-files-crumb-btn" @click="vm.goBreadcrumb(cr.path)">
          {{ cr.name }}
        </button>
      </template>
    </div>
  </div>

  <!-- 常用的四个留在外面，其余收进「更多」 -->
  <div class="g-files-mtools">
    <button type="button" class="g-files-mbtn" :class="{ 'is-busy': vm.loading }" @click="vm.load">
      <GIcon icon="ant-design:reload-outlined" :size="16" />
      <span>刷新</span>
    </button>
    <button type="button" class="g-files-mbtn" :disabled="vm.uploading" @click="$emit('pick-upload')">
      <GIcon icon="ant-design:upload-outlined" :size="16" />
      <span>{{ vm.uploadHint ? vm.uploadHint : '上传' }}</span>
    </button>
    <button type="button" class="g-files-mbtn" @click="vm.openCreate('dir')">
      <GIcon icon="ant-design:folder-add-outlined" :size="16" />
      <span>新建</span>
    </button>
    <button
      type="button"
      class="g-files-mbtn"
      :class="{ 'is-on': vm.selectMode }"
      @click="vm.selectMode ? vm.exitSelectMode() : (vm.selectMode = true)"
    >
      <GIcon icon="ant-design:unordered-list-outlined" :size="16" />
      <span>{{ vm.selectMode ? '取消' : '多选' }}</span>
    </button>
    <a-dropdown :trigger="['click']" placement="bottomRight">
      <button type="button" class="g-files-mbtn">
        <GIcon icon="ant-design:more-outlined" :size="16" />
        <span>更多</span>
      </button>
      <template #overlay>
        <a-menu>
          <a-menu-item @click="vm.calcAllSizes">算全部大小</a-menu-item>
          <a-menu-item @click="vm.downloadCurrent">下载当前目录</a-menu-item>
          <a-menu-item @click="$emit('pick-upload-dir')">上传文件夹</a-menu-item>
          <a-menu-item @click="vm.openCreate('file')">新建文件</a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </div>

  <div class="g-files-cards" :class="{ 'has-bulk': vm.selectMode }">
    <div v-if="!vm.list.length" class="g-files-mempty">
      <a-empty
        :image="false"
        :description="vm.currentPath ? '这个目录是空的' : 'Yunzai 根目录是空的'"
      />
    </div>

    <div
      v-for="f in vm.list"
      :key="f.name"
      class="g-files-card"
      :class="{ 'is-dir': f.isDir, 'is-selected': vm.isSelected(f) }"
      @click="onCardClick(f)"
    >
      <span class="g-files-card-ico">
        <GIcon
          :icon="f.isDir ? 'ant-design:folder-outlined' : 'ant-design:file-outlined'"
          :color="f.isDir ? 'var(--g-brand-ink)' : 'var(--g-text-dim)'"
          :size="22"
        />
      </span>
      <span class="g-files-card-main">
        <span class="g-files-card-name">{{ f.name }}</span>
        <span class="g-files-card-meta">{{ cardMeta(f) }}</span>
      </span>
      <span class="g-files-card-tail" @click.stop>
        <a-checkbox v-if="vm.selectMode" :checked="vm.isSelected(f)" @change="vm.toggleSelect(f)" />
        <a-dropdown v-else :trigger="['click']" placement="bottomRight">
          <button type="button" class="g-files-card-more" title="更多操作">
            <GIcon icon="ant-design:more-outlined" :size="16" />
          </button>
          <template #overlay>
            <a-menu @click="onCardMenuClick($event, f)">
              <a-menu-item v-if="!f.isDir" key="open">预览</a-menu-item>
              <a-menu-item v-if="!f.isDir && vm.isEditable(f)" key="edit">编辑</a-menu-item>
              <a-menu-item v-if="f.isDir" key="size">计算大小</a-menu-item>
              <a-menu-item key="download">下载</a-menu-item>
              <a-menu-item key="rename">重命名</a-menu-item>
              <a-menu-item key="delete" danger>删除</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </span>
    </div>
  </div>

  <!-- 吸底操作条：手指够得着，也避开 iPhone 的 home 条 -->
  <div v-if="vm.selectMode" class="g-files-bulk is-fixed">
    <span class="g-files-bulk-count"><b>{{ vm.selectedNames.length }}</b> 项</span>
    <a-button size="small" @click="vm.toggleSelectAll">
      {{ vm.allSelected ? '取消全选' : '全选' }}
    </a-button>
    <a-button
      size="small"
      type="primary"
      danger
      :disabled="!vm.selectedNames.length"
      @click="vm.confirmBatchDelete"
    >
      删除
    </a-button>
    <a-button size="small" type="text" @click="vm.exitSelectMode">取消</a-button>
  </div>
</template>

<style scoped>
.g-files-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  min-width: 0;
}

.g-files-crumb {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.g-files-crumb::-webkit-scrollbar {
  display: none;
}

.g-files-crumb-btn {
  flex: none;
  border: none;
  background: none;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--g-text-sub);
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.g-files-crumb-btn.is-root {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--g-brand-ink);
  font-weight: 500;
}

.g-files-crumb-btn.is-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: var(--g-bg-soft);
}

.g-files-sep {
  flex: none;
  color: var(--g-text-dim);
}

.g-files-mtools {
  display: flex;
  gap: 6px;
  margin: 0 0 10px;
  padding-bottom: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.g-files-mtools::-webkit-scrollbar {
  display: none;
}

.g-files-mbtn {
  flex: none;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 56px;
  height: 48px;
  padding: 4px 10px;
  border: 1px solid var(--g-border);
  border-radius: var(--g-radius);
  background: var(--g-bg-card);
  color: var(--g-text-sub);
  font-size: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.g-files-mbtn:active {
  background: var(--g-bg-soft);
}

.g-files-mbtn.is-on {
  border-color: var(--g-brand);
  background: var(--g-brand);
  color: var(--g-brand-fg);
}

.g-files-mbtn:disabled {
  opacity: 0.5;
}

.g-files-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 16px;
}

/* 多选时底部多出一条吸底操作条，给列表垫出等高的空间，最后一张卡片才不会被压住 */
.g-files-cards.has-bulk {
  padding-bottom: calc(92px + env(safe-area-inset-bottom));
}

.g-files-mempty {
  padding: 40px 0;
}

.g-files-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--g-border);
  border-radius: var(--g-radius);
  background: var(--g-bg-card);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

/* 只换底色，不做缩放：缩放会让毛玻璃背景重新采样，反而像糊了一下 */
.g-files-card:active {
  background: var(--g-bg-soft);
}

.g-files-card.is-selected {
  border-color: var(--g-brand);
  background: var(--g-brand-soft);
}

/* 图标垫一块浅底：扫列表时先看到色块，比裸图标更好定位 */
.g-files-card-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--g-bg-soft);
}

.g-files-card.is-dir .g-files-card-ico {
  background: var(--g-brand-soft);
}

.g-files-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.g-files-card-name {
  overflow: hidden;
  color: var(--g-text);
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-files-card.is-dir .g-files-card-name {
  color: var(--g-brand-ink);
  font-weight: 600;
}

.g-files-card-meta {
  color: var(--g-text-sub);
  font-size: 12px;
}

.g-files-card-tail {
  flex: none;
  display: inline-flex;
  align-items: center;
}

.g-files-card-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--g-text-sub);
  cursor: pointer;
}

.g-files-card-more:active {
  background: var(--g-bg-soft);
}

/* ---------------- 批量选择 ---------------- */

.g-files-bulk {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--g-border);
  border-radius: var(--g-radius);
  background: var(--g-bg-elevated);
  box-shadow: var(--g-shadow);
}

.g-files-bulk.is-fixed {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom));
  z-index: 60;
}

.g-files-bulk-count {
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-files-bulk-count b {
  color: var(--g-brand);
}
</style>
