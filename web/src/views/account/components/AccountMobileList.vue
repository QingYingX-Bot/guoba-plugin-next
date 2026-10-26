<script setup lang="ts">
/**
 * 账号管理 · 手机卡片列表。
 *
 * 好友 / 群聊两个表格在手机上要横着拖才看得到 QQ 号和操作列，换成卡片：
 * 一行一个，点卡片勾选（群发用），「⋯」里放复制和删除 / 退群。
 * 好友与群的差别只有头像形状和副标题，用 kind 区分，不拆成两个文件。
 */
import { Avatar, Dropdown, Menu, MenuItem, Pagination, message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { groupAvatar, userAvatar } from '@/utils/avatar'

const props = defineProps<{
  kind: 'friend' | 'group'
  records: any[]
  selected: Array<string | number>
  total: number
  pageNo: number
  pageSize: number
}>()

const emit = defineEmits<{
  (e: 'update:selected', keys: Array<string | number>): void
  (e: 'danger', record: any): void
  (e: 'page-change', pageNo: number): void
}>()

function keyOf(r: any) {
  return String(props.kind === 'friend' ? r.user_id : r.group_id)
}

function isSelected(r: any) {
  return props.selected.includes(keyOf(r))
}

function toggle(r: any) {
  const key = keyOf(r)
  emit(
    'update:selected',
    isSelected(r) ? props.selected.filter((k) => String(k) !== key) : [...props.selected, key],
  )
}

function avatarOf(r: any) {
  return props.kind === 'friend'
    ? userAvatar(r?.user_id, { avatar: r?.avatar })
    : groupAvatar(r?.group_id, { avatar: r?.avatar })
}

function initialOf(r: any) {
  const name = props.kind === 'friend' ? r?.nickname : r?.group_name
  return String(name ?? '?').slice(0, 1)
}

function roleText(role?: string) {
  if (role === 'owner') return { text: '群主', color: 'gold' }
  if (role === 'admin') return { text: '管理员', color: 'blue' }
  return { text: '成员', color: 'default' }
}

async function copyId(r: any) {
  const id = props.kind === 'friend' ? r.user_id : r.group_id
  try {
    await navigator.clipboard.writeText(String(id))
    message.success('已复制')
  } catch {
    message.warning('复制失败，请手动选中复制')
  }
}

function onMenu(key: string, r: any) {
  if (key === 'copy') void copyId(r)
  else if (key === 'danger') emit('danger', r)
}
</script>

<template>
  <div class="g-acc-cards">
    <a-empty v-if="!records.length" :image="false" description="没有数据" />

    <div
      v-for="r in records"
      :key="keyOf(r)"
      class="g-acc-card"
      :class="{ 'is-selected': isSelected(r) }"
      @click="toggle(r)"
    >
      <span class="g-acc-card-avatar">
        <Avatar :src="avatarOf(r)" :size="42" :shape="kind === 'group' ? 'square' : 'circle'">
          {{ initialOf(r) }}
        </Avatar>
        <span v-if="isSelected(r)" class="g-acc-card-check" />
      </span>

      <span class="g-acc-card-main">
        <span class="g-acc-card-name">
          {{ kind === 'friend' ? r.nickname || '未知昵称' : r.group_name || '未知群名' }}
        </span>
        <span class="g-acc-card-meta">
          <template v-if="kind === 'friend'">
            {{ r.user_id }}
            <template v-if="r.remark"> · {{ r.remark }}</template>
          </template>
          <template v-else>
            {{ r.group_id }} · {{ r.member_count ?? '—' }} 人
            <a-tag :color="roleText(r.role).color" class="g-acc-card-role">
              {{ roleText(r.role).text }}
            </a-tag>
          </template>
        </span>
      </span>

      <span class="g-acc-card-tail" @click.stop>
        <a-dropdown :trigger="['click']" placement="bottomRight">
          <button type="button" class="g-acc-card-more" title="更多操作">
            <GIcon icon="ant-design:more-outlined" :size="16" />
          </button>
          <template #overlay>
            <a-menu @click="({ key }: any) => onMenu(String(key), r)">
              <a-menu-item key="copy">复制{{ kind === 'friend' ? ' QQ' : '群号' }}</a-menu-item>
              <a-menu-item key="danger" danger>
                {{ kind === 'friend' ? '删除好友' : '退群' }}
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </span>
    </div>

    <a-pagination
      v-if="total > pageSize"
      class="g-acc-pager"
      simple
      :current="pageNo"
      :page-size="pageSize"
      :total="total"
      @change="(p: number) => emit('page-change', p)"
    />
  </div>
</template>

<style scoped>
.g-acc-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}

.g-acc-card {
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

.g-acc-card:active {
  background: var(--g-bg-soft);
}

.g-acc-card.is-selected {
  border-color: var(--g-brand);
  background: var(--g-brand-soft);
}

.g-acc-card-avatar {
  position: relative;
  flex: none;
  display: inline-flex;
}

/* 勾选标记：内置图标集里没有 check，直接用两条边转 45° 画一个 */
.g-acc-card-check {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--g-brand);
  color: var(--g-brand-fg);
}

.g-acc-card-check::after {
  content: '';
  width: 4px;
  height: 8px;
  margin-top: -2px;
  border: solid currentColor;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.g-acc-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.g-acc-card-name {
  overflow: hidden;
  color: var(--g-text);
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-acc-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--g-text-sub);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-acc-card-role {
  margin-inline-end: 0;
  font-size: 10px;
  line-height: 16px;
}

.g-acc-card-tail {
  flex: none;
  display: inline-flex;
  align-items: center;
}

.g-acc-card-more {
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

.g-acc-card-more:active {
  background: var(--g-bg-soft);
}

.g-acc-pager {
  align-self: center;
  margin-top: 4px;
}
</style>
