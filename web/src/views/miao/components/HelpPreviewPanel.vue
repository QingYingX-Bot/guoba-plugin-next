<script setup lang="ts">
import { computed, ref } from 'vue'
import { Alert, Button, Card, Empty, Segmented, Spin } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { apiPreviewMiaoHelp } from '@/api'
import type { MiaoHelpCfgBody, MiaoHelpGroup } from '@/types'

/**
 * 帮助图预览面板。
 *
 * 出的是真图（后端走 puppeteer），比较慢，所以不跟着编辑实时刷新 —— 改完点一次「刷新预览」。
 * 传进来的是父组件的草稿，改完即最新，不用先保存就能看到效果。
 */
const props = defineProps<{
  cfg: MiaoHelpCfgBody
  list: MiaoHelpGroup[]
}>()

const loading = ref(false)
/** dataURL，空串表示还没出过图 */
const image = ref('')
const errorMsg = ref('')
/** 适应窗口：整图缩到一屏看得全；适配宽度：宽度撑满、纵向滚；原始大小：原尺寸 */
const fitMode = ref<'view' | 'width' | 'raw'>('view')

const fitOptions = [
  { label: '适应窗口', value: 'view' },
  { label: '适配宽度', value: 'width' },
  { label: '原始大小', value: 'raw' },
]

const isEmpty = computed(() => !props.list?.length)

async function refresh() {
  if (isEmpty.value) {
    errorMsg.value = '还没有任何分组，先加几条命令再预览'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await apiPreviewMiaoHelp(props.cfg, props.list)
    if (data?.image) {
      image.value = data.image
    } else {
      errorMsg.value = '预览生成失败，请稍后重试'
    }
  } catch (e: any) {
    errorMsg.value = e?.message || '预览生成失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Card :bordered="false" class="g-miao-card">
    <template #title><span class="g-miao-title">预览</span></template>

    <!-- 控制条放 body 里不放 Card 的 extra：三个档位加按钮塞进 extra 会把标题挤没，
         这里自己 flex-wrap，窄屏自动换行 -->
    <div class="g-preview-bar">
      <Segmented v-if="image" v-model:value="fitMode" :options="fitOptions" size="small" />
      <Button type="primary" size="small" :loading="loading" @click="refresh">
        <GIcon icon="ant-design:eye-outlined" :size="12" />
        <span class="g-btn-text">刷新预览</span>
      </Button>
    </div>

    <Spin :spinning="loading">
      <Alert v-if="errorMsg" type="warning" show-icon :message="errorMsg" class="g-preview-alert" />
      <div v-if="image" :class="['g-preview-wrap', fitMode]">
        <img :src="image" class="g-preview-img" alt="帮助图预览" />
      </div>
      <Empty v-else-if="!errorMsg" description="点右上角「刷新预览」，按当前编辑内容出一张图" />
    </Spin>
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

/* 窄屏放不下就换行，别把标题挤出去 */
.g-preview-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.g-preview-alert {
  margin-bottom: 12px;
}

/* 不设自身高度，由各模式决定；原始大小下横向超出时滚动 */
.g-preview-wrap {
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--g-border);
  border-radius: 8px;
  background: var(--g-bg-soft);
}

.g-preview-img {
  display: block;
  margin: 0 auto;
}

/* 适应窗口（默认）：整图完整塞进一屏。
   帮助图原图 990x1805，不缩的话 27 寸屏也得往下拉，所以按视口高度封顶，
   扣掉顶栏 + 卡片头 + 上下留白。宽度跟着等比缩，不用管 */
.g-preview-wrap.view .g-preview-img {
  max-width: 100%;
  max-height: calc(100vh - 240px);
  width: auto;
  height: auto;
}

/* 适配宽度：宽度撑满容器，纵向该多长就多长 */
.g-preview-wrap.width .g-preview-img {
  max-width: 100%;
  height: auto;
}

/* 原始大小：按出图原尺寸，放不下就横向滚 */
.g-preview-wrap.raw .g-preview-img {
  max-width: none;
  margin: 0;
}

.g-btn-text {
  margin-left: 4px;
}
</style>
