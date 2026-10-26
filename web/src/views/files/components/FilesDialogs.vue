<script setup lang="ts">
/**
 * 文件管理 · 弹窗。
 *
 * 预览 / 编辑、新建、重命名这三件在 PC 和手机上是同一套交互（都是 antd 的 Modal），
 * 所以不按端拆，放在这里给两个视图共用。
 */
import GIcon from '@/components/GIcon.vue'
import type { FileManager } from '../useFileManager'

defineProps<{ vm: FileManager }>()
</script>

<template>
  <!-- 预览 / 编辑：图片直接看大图，文本按内容宽度居中展示，可切编辑 -->
  <a-modal
    v-model:open="vm.viewOpen"
    :title="vm.viewName"
    :width="vm.viewMode === 'image' ? 'min(90vw, 960px)' : '760px'"
    :footer="null"
    destroy-on-close
  >
    <div class="g-files-preview">
      <template v-if="vm.viewMode === 'image'">
        <img :src="vm.fileUrl(vm.viewPath)" :alt="vm.viewName" class="g-files-img" />
      </template>
      <template v-else-if="vm.viewMode === 'text'">
        <pre v-if="!vm.editing" class="g-files-code">{{ vm.viewContent }}</pre>
        <a-textarea
          v-else
          v-model:value="vm.viewContent"
          :auto-size="{ minRows: 2 }"
          spellcheck="false"
          class="g-files-edit"
        />
      </template>
    </div>

    <div v-if="vm.viewMode === 'text'" class="g-files-view-actions">
      <template v-if="!vm.editing">
        <a-button type="primary" @click="vm.editing = true">
          <GIcon icon="ant-design:edit-outlined" :size="13" />
          编辑
        </a-button>
      </template>
      <template v-else>
        <a-button @click="vm.editing = false">取消</a-button>
        <a-button type="primary" :loading="vm.saving" @click="vm.savePreview">保存</a-button>
      </template>
    </div>
  </a-modal>

  <!-- 新建：就输个名字，窄一点。width 要传数字，antd 才会补 px，字符串无单位会被 CSS 忽略 -->
  <a-modal
    v-model:open="vm.createOpen"
    :title="vm.createType === 'dir' ? '新建文件夹' : '新建文件'"
    :width="300"
    @ok="vm.submitCreate"
  >
    <a-input
      v-model:value="vm.createName"
      :placeholder="vm.createType === 'dir' ? '文件夹名' : '文件名'"
      @press-enter="vm.submitCreate"
    />
  </a-modal>

  <!-- 重命名 -->
  <a-modal v-model:open="vm.renameOpen" title="重命名" :width="300" @ok="vm.submitRename">
    <a-input v-model:value="vm.renameName" @press-enter="vm.submitRename" />
  </a-modal>
</template>

<style scoped>
/* 预览区：内容块居中，宽度自适应内容，不占满整个 modal */
.g-files-preview {
  text-align: center;
}

/* 代码块 inline-block，由内容（最长行）决定宽度；超宽内部横向滚动 */
.g-files-code {
  display: inline-block;
  max-width: 100%;
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: var(--g-bg-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  text-align: left;
  white-space: pre;
  word-break: normal;
}

.g-files-img {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 6px;
  box-shadow: var(--g-shadow);
}

.g-files-edit {
  text-align: left;
  /* 跟预览的 pre 同一套排版：padding / 字号 / 行高一致，高度才对得上；
     auto-size 让高度跟随内容行数，超长时在这里封顶内部滚动 */
  max-height: 60vh;
  overflow-y: auto;
  padding: 10px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.g-files-view-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
</style>
