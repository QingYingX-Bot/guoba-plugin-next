<script setup lang="ts">
/**
 * 全局布局入口。
 *
 * 只做一件事：按 appStore.isMobile 选 PC 版还是手机版。两套布局的结构差异很大
 * （固定侧栏 vs 覆盖抽屉），各自在 components/LayoutPc.vue、LayoutMobile.vue 里写，
 * 这里不掺任何渲染，避免又长回一个文件。
 */
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import LayoutPc from './components/LayoutPc.vue'
import LayoutMobile from './components/LayoutMobile.vue'

const appStore = useAppStore()
const isMobile = computed(() => appStore.isMobile)

onMounted(() => appStore.setupResponsive())
</script>

<template>
  <LayoutPc v-if="!isMobile" />
  <LayoutMobile v-else />
</template>
