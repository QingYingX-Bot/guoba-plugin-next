<script setup lang="ts">
/**
 * 文件管理 · PC 视图。
 *
 * 面包屑 + 一整排工具按钮 + 表格。勾选走表格自带的 rowSelection（表头就是全选），
 * 勾上以后顶部浮出一条批量操作条。手机端不用这套，见 FilesMobileView.vue。
 */
import { computed } from 'vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import type { FileManager } from '../useFileManager'

const props = defineProps<{ vm: FileManager }>()

const appStore = useAppStore()
/** 手机屏幕上看桌面版：表格比屏幕宽，给一句「可以左右滑」的提示 */
const narrowPc = computed(() => appStore.viewportNarrow && !appStore.isMobile)

/**
 * 表格左右翻页。
 *
 * 手机上横向手势经常被浏览器吃掉（返回手势、下拉刷新），
 * 光提示「可以左右滑」不解决问题，给两个按钮点一下滚半屏，一定能动。
 */
function scrollTable(dir: number) {
  const el = tableScrollEl()
  if (!el) return
  el.scrollBy({ left: dir * Math.max(180, Math.round(el.clientWidth * 0.7)), behavior: 'smooth' })
}

/**
 * 窄屏桌面版：自己接手横向滑动。
 *
 * 手机上浏览器经常把横向手势吃掉（返回手势、外层滚动容器抢），
 * overflow 写了也滑不动。这里在触摸事件里直接改 scrollLeft，
 * 只有横向位移明显大于纵向时才拦，纵向滚动照常。
 */
let touchX = 0
let touchY = 0
let touchLeft = 0
let dragging = false

/**
 * 真正的横向滚动层。
 *
 * 注意：不能用逗号选择器一次查 —— querySelector 返回的是文档顺序里第一个匹配的，
 * 外层 .ant-table-container 永远排在前面，而它自己不可滚（scrollWidth 等于内容宽）。
 * 必须按优先级一个个找。
 */
function tableScrollEl() {
  const root = document.querySelector('.g-files')
  if (!root) return null
  return (
    root.querySelector<HTMLElement>('.ant-table-body') ??
    root.querySelector<HTMLElement>('.ant-table-content') ??
    root.querySelector<HTMLElement>('.ant-table-container')
  )
}

function onTableTouchStart(e: TouchEvent) {
  if (!narrowPc.value) return
  const t = e.touches[0]
  if (!t) return
  touchX = t.clientX
  touchY = t.clientY
  touchLeft = tableScrollEl()?.scrollLeft ?? 0
  dragging = false
}

function onTableTouchMove(e: TouchEvent) {
  if (!narrowPc.value) return
  const t = e.touches[0]
  const el = tableScrollEl()
  if (!t || !el) return
  const dx = t.clientX - touchX
  const dy = t.clientY - touchY
  if (!dragging && Math.abs(dx) > Math.abs(dy) + 4) dragging = true
  if (!dragging) return
  e.preventDefault()
  el.scrollLeft = touchLeft - dx
}

/** 上传用的 input 只有一份，放在父页面；这里只负责喊一声 */
defineEmits<{
  (e: 'pick-upload'): void
  (e: 'pick-upload-dir'): void
}>()

/**
 * 列宽。
 *
 * 手机屏上切桌面版时内容区只有 300 出头，名称列自适应会把「大小」挤出屏幕。
 * 窄屏下把名称压到 150、大小压到 86，首屏正好放下这两列，时间和操作往右滑。
 */
const columns = computed(() =>
  narrowPc.value
    ? [
        { title: '名称', dataIndex: 'name', key: 'name', width: 172, ellipsis: true },
        { title: '大小', key: 'size', width: 86 },
        { title: '修改时间', key: 'mtime', width: 150 },
        { title: '操作', key: 'op', width: 220 },
      ]
    : [
        { title: '名称', dataIndex: 'name', key: 'name' },
        { title: '大小', key: 'size', width: 120 },
        { title: '修改时间', key: 'mtime', width: 180 },
        { title: '操作', key: 'op', width: 240 },
      ],
)

const rowSelection = computed(() => ({
  selectedRowKeys: props.vm.selectedNames,
  columnWidth: 44,
  onChange: (keys: Array<string | number>) => {
    props.vm.selectedNames = keys.map(String)
  },
}))
</script>

<template>
  <div class="g-files-bar">
    <div class="g-files-crumb">
      <button type="button" class="g-files-crumb-btn is-root" @click="vm.goBreadcrumb('')">
        Yunzai
      </button>
      <template v-for="cr in vm.breadcrumbs" :key="cr.path">
        <GIcon icon="ant-design:right-outlined" :size="11" class="g-files-sep" />
        <button type="button" class="g-files-crumb-btn" @click="vm.goBreadcrumb(cr.path)">
          {{ cr.name }}
        </button>
      </template>
    </div>

    <!-- 手机上的桌面版：只留四个常用，其余收进「更多」，别让工具栏吃掉半屏 -->
    <div v-if="narrowPc" class="g-files-acts">
      <a-button size="small" :loading="vm.loading" @click="vm.load">
        <GIcon icon="ant-design:reload-outlined" :size="13" />
        刷新
      </a-button>
      <a-button size="small" :loading="vm.uploading" @click="$emit('pick-upload')">
        <GIcon icon="ant-design:upload-outlined" :size="13" />
        上传
      </a-button>
      <a-button size="small" @click="vm.openCreate('dir')">
        <GIcon icon="ant-design:folder-add-outlined" :size="13" />
        新建
      </a-button>
      <a-dropdown :trigger="['click']" placement="bottomRight">
        <a-button size="small">
          <GIcon icon="ant-design:more-outlined" :size="13" />
          更多
        </a-button>
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

    <div v-else class="g-files-acts">
      <a-button size="small" :loading="vm.loading" @click="vm.load">
        <GIcon icon="ant-design:reload-outlined" :size="13" />
        刷新
      </a-button>
      <a-button size="small" :loading="vm.calcAllRunning" @click="vm.calcAllSizes">
        <GIcon icon="ant-design:calculator-outlined" :size="13" />
        算全部大小
      </a-button>

      <!-- 分个组：前两个是「看」，中间三个是「拿进来 / 拿出去」，最后两个是「新建」 -->
      <span class="g-files-divider" />

      <a-button size="small" title="把当前目录整个打包成 zip 下载" @click="vm.downloadCurrent">
        <GIcon icon="ant-design:file-zip-outlined" :size="13" />
        下载当前目录
      </a-button>
      <a-button size="small" :loading="vm.uploading" @click="$emit('pick-upload')">
        <GIcon icon="ant-design:upload-outlined" :size="13" />
        上传
      </a-button>
      <a-button
        size="small"
        :loading="vm.uploading"
        title="选择整个文件夹上传，会按原来的目录结构放进当前目录"
        @click="$emit('pick-upload-dir')"
      >
        <GIcon icon="ant-design:folder-open-outlined" :size="13" />
        {{ vm.uploadHint ? `上传文件夹 ${vm.uploadHint}` : '上传文件夹' }}
      </a-button>

      <span class="g-files-divider" />

      <a-button size="small" @click="vm.openCreate('dir')">
        <GIcon icon="ant-design:folder-add-outlined" :size="13" />
        新建文件夹
      </a-button>
      <a-button size="small" @click="vm.openCreate('file')">
        <GIcon icon="ant-design:file-add-outlined" :size="13" />
        新建文件
      </a-button>
    </div>
  </div>

  <!-- 勾了就出现，不用再滚到表格底部找按钮 -->
  <div v-if="vm.selectedNames.length" class="g-files-bulk">
    <span class="g-files-bulk-count">已选 <b>{{ vm.selectedNames.length }}</b> 项</span>
    <a-button size="small" @click="vm.toggleSelectAll">
      {{ vm.allSelected ? '取消全选' : '全选' }}
    </a-button>
    <a-button size="small" @click="vm.clearSelection">清空</a-button>
    <a-button size="small" type="primary" danger @click="vm.confirmBatchDelete">
      <GIcon icon="ant-design:delete-outlined" :size="13" />
      删除选中
    </a-button>
  </div>

  <div v-if="narrowPc" class="g-files-slide-hint">
    <button type="button" class="g-files-scroll-btn" @click="scrollTable(-1)">
      <GIcon icon="ant-design:left-outlined" :size="12" />
    </button>
    <span>左右滑动</span>
    <button type="button" class="g-files-scroll-btn" @click="scrollTable(1)">
      <GIcon icon="ant-design:right-outlined" :size="12" />
    </button>
  </div>

  <div
    class="g-files-table-wrap"
    @touchstart.passive="onTableTouchStart"
    @touchmove="onTableTouchMove"
  >
    <a-table
    class="g-files-table"
    :data-source="vm.list"
    :columns="columns"
    :pagination="false"
    :row-selection="rowSelection"
    :scroll="narrowPc ? { x: 650 } : undefined"
    row-key="name"
    size="small"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'name'">
        <span
          class="g-files-name"
          :class="{ 'is-dir': record.isDir }"
          :title="record.isDir ? '进入文件夹' : '单击预览'"
          @click="vm.onOpen(record)"
        >
          <GIcon
            :icon="record.isDir ? 'ant-design:folder-outlined' : 'ant-design:file-outlined'"
            :color="record.isDir ? 'var(--g-brand-ink)' : 'var(--g-text-dim)'"
            :size="15"
          />
          <span>{{ record.name }}</span>
        </span>
      </template>

      <template v-else-if="column.key === 'size'">
        <template v-if="!record.isDir">{{ vm.fmtSize(record.size) }}</template>
        <!-- 文件夹：算过就显示结果（可点重算），没算过给个「计算」 -->
        <a-button
          v-else
          size="small"
          type="text"
          class="g-files-size-btn"
          :loading="vm.dirSizes[vm.joinPath(record.name)]?.loading"
          :title="vm.dirSizeTitle(record)"
          @click="vm.calcSize(record)"
        >
          {{ vm.dirSizeText(record) || '计算' }}
        </a-button>
      </template>

      <template v-else-if="column.key === 'mtime'">
        {{ vm.fmtTime(record.mtime) }}
      </template>

      <template v-else-if="column.key === 'op'">
        <!-- 文件夹也占一个编辑位，保证下载列对齐（文件夹的编辑禁用） -->
        <a-button
          size="small"
          type="text"
          :disabled="record.isDir || !vm.isEditable(record)"
          :title="record.isDir ? '文件夹' : vm.isEditable(record) ? '编辑' : '二进制或超过 2MB，无法在页面编辑'"
          @click="vm.onEdit(record)"
        >
          <GIcon icon="ant-design:edit-outlined" :size="13" />
          编辑
        </a-button>
        <a
          class="g-files-op"
          :href="vm.downloadUrl(record)"
          :title="record.isDir ? '打包成 zip 下载' : '下载'"
        >
          <GIcon
            :icon="record.isDir ? 'ant-design:file-zip-outlined' : 'ant-design:cloud-download-outlined'"
            :size="13"
          />
          下载
        </a>
        <a-button size="small" type="text" @click="vm.openRename(record)">改名</a-button>
        <a-button size="small" type="text" danger @click="vm.confirmDelete(record)">删除</a-button>
      </template>
    </template>

    <template #emptyText>
      <a-empty
        :image="false"
        :description="vm.currentPath ? '这个目录是空的' : 'Yunzai 根目录是空的'"
      />
    </template>
  </a-table>
  </div>
</template>

<style scoped>
/* antd 4 的按钮是 inline-block + 基线对齐，svg 图标会被顶起来跟文字错位；
   改成 flex 居中，图标和文字才垂直对齐 */
.g-files-bar :deep(.ant-btn),
.g-files-bulk :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.g-files-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.g-files-crumb {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.g-files-crumb-btn {
  border: none;
  background: none;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--g-text-sub);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.g-files-crumb-btn:hover {
  background: var(--g-bg-soft);
  color: var(--g-brand);
}

.g-files-crumb-btn.is-root {
  /* 跟上面的文件夹名用同一个色，面包屑和列表看着才是一套 */
  color: var(--g-brand-ink);
  font-weight: 500;
}

.g-files-sep {
  color: var(--g-text-dim);
  flex: none;
}

.g-files-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

/* 横向滑动由 JS 接管，这里只放行纵向手势，避免浏览器自己抢 */
.g-files-table-wrap {
  touch-action: pan-y;
}

/* 窄屏桌面版：一句提示 + 两个翻页按钮，手势被浏览器吃掉时也能滚 */
.g-files-slide-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: -4px 0 6px;
  color: var(--g-text-dim);
  font-size: 11px;
}

.g-files-scroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--g-brand);
  border-radius: 50%;
  background: var(--g-brand);
  color: #fff;
  cursor: pointer;
}

.g-files-scroll-btn:active {
  background: var(--g-bg-soft);
}

/* 工具栏分组线：七个按钮排一排太糊，用一条细线把「查看 / 传输 / 新建」分开 */
.g-files-divider {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--g-border);
}

.g-files-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  color: var(--g-text);
  font-size: 13px;
  cursor: pointer;
}

/**
 * 文件夹与单文件必须一眼分清。
 *
 * 试过「只调文字色」和「给名字垫底片」两条路，都不行：前者两个都是低饱和深色，并排放着
 * 实测看不出差别；后者一排灰色药丸连成串，又俗又占地方。
 * 最后落在**图标**上 —— 图标在模板里直接给颜色（文件压淡、文件夹上色），
 * 扫一眼先看到图标，不用读名字就能分出哪边是文件夹。
 */
.g-files-name.is-dir {
  color: var(--g-brand-ink);
  font-weight: 600;
}

.g-files-name span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-files-op {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  color: var(--g-text-sub);
  font-size: 12px;
}

.g-files-op:hover {
  color: var(--g-brand);
}

/* 大小列的「计算」/ 结果按钮：跟文件的纯文本大小视觉重量接近，别抢眼 */
.g-files-size-btn {
  padding: 0 4px;
  height: auto;
  color: var(--g-text-sub);
  font-size: 12px;
}

.g-files-size-btn:hover {
  color: var(--g-brand);
}

/* ---------------- 批量选择 ---------------- */

.g-files-bulk {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border: 1px solid var(--g-brand-line);
  border-radius: var(--g-radius);
  background: var(--g-brand-soft);
}

.g-files-bulk-count {
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-files-bulk-count b {
  color: var(--g-brand);
}
</style>
