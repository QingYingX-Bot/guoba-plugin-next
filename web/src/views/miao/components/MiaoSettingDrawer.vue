<script setup lang="ts">
import { computed } from 'vue'
import {
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  RadioButton,
  RadioGroup,
  Select,
  Switch,
} from 'ant-design-vue'
import type { MiaoHelpCfgBody } from '@/types'

/**
 * 喵喵帮助的全局设置。
 */
const props = defineProps<{
  open: boolean
  cfg: MiaoHelpCfgBody
  themeNames: string[]
}>()

const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const themeOptions = computed(() => props.themeNames.map((n) => ({ label: n, value: n })))

/**
 * 统一按数组编辑，空数组交给后端转回 'all'（见 saveHelpSetting）。
 */
const themeValue = computed<string[]>({
  get() {
    const t = props.cfg.theme
    if (t === 'all' || t == null) return []
    return Array.isArray(t) ? t : [t]
  },
  set(val) {
    props.cfg.theme = val.length ? val : 'all'
  },
})

const excludeValue = computed<string[]>({
  get: () => (Array.isArray(props.cfg.themeExclude) ? props.cfg.themeExclude : []),
  set: (val) => {
    props.cfg.themeExclude = val
  },
})
</script>

<template>
  <Drawer
    :open="open"
    title="帮助设置"
    placement="right"
    :width="360"
    @update:open="emit('update:open', $event)"
  >
    <Form layout="vertical">
      <FormItem label="帮助标题">
        <Input v-model:value="cfg.title" placeholder="使用帮助" allowClear />
      </FormItem>

      <FormItem label="副标题">
        <Input v-model:value="cfg.subTitle" placeholder="Yunzai-Bot & Miao-Plugin" allowClear />
      </FormItem>

      <FormItem label="列数" extra="列数过多容易看不过来，2-5 之间">
        <RadioGroup v-model:value="cfg.colCount" button-style="solid">
          <RadioButton v-for="n in [2, 3, 4, 5]" :key="n" :value="n">{{ n }}</RadioButton>
        </RadioGroup>
      </FormItem>

      <FormItem label="单列宽度（px）" extra="太窄文字会频繁换行，默认 265">
        <InputNumber
          v-model:value="cfg.colWidth"
          :min="100"
          :max="500"
          :step="5"
          class="g-full"
        />
      </FormItem>

      <FormItem label="背景毛玻璃" extra="出图时如果底图渲染有问题可以关掉">
        <Switch v-model:checked="cfg.bgBlur" />
      </FormItem>

      <FormItem label="皮肤" extra="不选则使用全部皮肤，每次出图随机挑一个">
        <Select
          v-model:value="themeValue"
          mode="multiple"
          :options="themeOptions"
          placeholder="全部皮肤（all）"
          allowClear
        />
      </FormItem>

      <FormItem label="排除皮肤" extra="被排除的皮肤不会被随机到">
        <Select
          v-model:value="excludeValue"
          mode="multiple"
          :options="themeOptions"
          placeholder="不排除任何皮肤"
          allowClear
        />
      </FormItem>
    </Form>

    <p class="g-note">
      配色（标题色、描述色、底色、行底色）由皮肤决定，请到下方「皮肤管理」里改。
    </p>
  </Drawer>
</template>

<style scoped>
.g-full {
  width: 100%;
}

.g-note {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--g-text-sub);
  background: var(--g-bg-soft);
  border-radius: 8px;
}
</style>
