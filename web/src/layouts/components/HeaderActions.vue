<script setup lang="ts">
/**
 * 顶栏右侧：主题切换 + 用户头像菜单。
 *
 * PC 和手机顶栏只有左边不一样（面包屑 vs 当前页名），右边这套完全共用，
 * 所以从两个顶栏里抽出来，改一个地方两边都生效。
 */
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Avatar,
  Button,
  Dropdown,
  Menu,
  MenuDivider,
  MenuItem,
  Modal,
  Tooltip,
  message,
} from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { apiRestartBot, apiRestartGuoba } from '@/api'

const appStore = useAppStore()
const auth = useAuthStore()
const router = useRouter()

const userName = computed(
  () => auth.user?.realName || String(auth.user?.username ?? '') || '未登录',
)

const avatarText = computed(() => {
  // 昵称可能以颜文字或标点开头（如 `(o° ▽° )o☆`），直接取首字符会渲染出一个括号，
  // 这里跳过符号，取第一个字母/数字/汉字
  const matched = userName.value.match(/[\p{L}\p{N}]/u)
  return matched ? matched[0].toUpperCase() : 'G'
})

/**
 * 机器人头像。地址由后端按适配器算好（server/service/both/model/avatar.js）——
 * 官方机器人、stdin 这类账号没有公开地址，那时是空串，Avatar 自己退回上面的首字；
 * 图片加载失败（断网、腾讯挂了）也会退回去，不用额外处理。
 */
const avatarUrl = computed(() => auth.user?.avatar || '')

/** 手动切换界面模式：当前是哪套就切到另一套，回到 auto 去「外观设置」 */
function toggleViewMode() {
  appStore.setViewMode(appStore.isMobile ? 'pc' : 'mobile')
}

/**
 * 全屏。
 *
 * 手机浏览器的地址栏没法用网页隐藏（安全限制），只能靠浏览器自己的全屏模式。
 * 全屏必须由用户点一下才允许，所以做成菜单项，不能自动进。
 */
const isFullscreen = ref(false)

function syncFullscreen() {
  isFullscreen.value = !!document.fullscreenElement
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    message.warning('这个浏览器不支持全屏，可以在 Edge 设置里把地址栏换到顶部')
  }
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
})

function confirmRestartBot() {
  Modal.confirm({
    title: '重启 Bot',
    content: '重启 Yunzai，机器人会短暂离线。继续？',
    okText: '确定重启',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await apiRestartBot()
    },
  })
}

function confirmRestartGuoba() {
  Modal.confirm({
    title: '重启锅巴服务',
    content: '仅重启锅巴的服务端，不影响机器人本体。确定继续？',
    okText: '确定重启',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await apiRestartGuoba()
      message.info('锅巴服务已重启，如页面异常请刷新')
    },
  })
}

function confirmLogout() {
  Modal.confirm({
    title: '退出登录',
    content: '退出后要重新登录，可信设备记录会保留。',
    okText: '退出',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      await auth.logout()
      router.replace('/login')
    },
  })
}

const userMenu = () =>
  h(Menu, null, {
    default: () => [
      h(
        MenuItem,
        { key: 'account', onClick: () => router.push('/account') },
        { default: () => '账号管理' },
      ),
      h(
        MenuItem,
        { key: 'view-mode', onClick: toggleViewMode },
        { default: () => (appStore.isMobile ? '切换到桌面版' : '切换到手机版') },
      ),
      h(
        MenuItem,
        { key: 'fullscreen', onClick: toggleFullscreen },
        { default: () => (isFullscreen.value ? '退出全屏' : '全屏显示') },
      ),
      h(
        MenuItem,
        { key: 'about', onClick: () => router.push('/about') },
        { default: () => '关于锅巴' },
      ),
      h(MenuDivider),
      h(
        MenuItem,
        { key: 'restart-guoba', onClick: confirmRestartGuoba },
        { default: () => '重启锅巴服务' },
      ),
      h(
        MenuItem,
        { key: 'restart-bot', danger: true, onClick: confirmRestartBot },
        { default: () => '重启 Bot' },
      ),
      h(MenuDivider),
      h(
        MenuItem,
        { key: 'logout', danger: true, onClick: confirmLogout },
        { default: () => '退出登录' },
      ),
    ],
  })
</script>

<template>
  <div class="g-header-actions">
    <Tooltip :title="appStore.isDark ? '切换到浅色' : '切换到深色'">
      <Button type="text" class="g-icon-btn" @click="appStore.toggleTheme()">
        <GIcon
          :icon="appStore.isDark ? 'ant-design:sun-outlined' : 'ant-design:moon-outlined'"
          :size="17"
        />
      </Button>
    </Tooltip>

    <Dropdown :trigger="['click']">
      <div class="g-user">
        <Avatar :size="28" class="g-avatar" :src="avatarUrl">{{ avatarText }}</Avatar>
        <span class="g-user-name">{{ userName }}</span>
        <GIcon icon="ant-design:down-outlined" :size="11" />
      </div>
      <template #overlay>
        <component :is="userMenu" />
      </template>
    </Dropdown>
  </div>
</template>

<style scoped>
.g-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/**
 * antd 的 .ant-btn 自带 padding: 4px 15px，这里又把宽度锁成 34px，
 * 图标作为 flex item 会被横向压扁成一个小点，所以必须清掉 padding，
 * 并禁止图标收缩。
 */
.g-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--g-text-sub);
}

.g-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  cursor: pointer;
  color: var(--g-text-sub);
}

.g-avatar {
  background: var(--g-brand);
  color: #1a1408;
  font-weight: 600;
  overflow: hidden;
}

/* 有图片时铺满圆，不再露出品牌色底圈 */
.g-avatar :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.g-user-name {
  font-size: 13px;
  color: var(--g-text);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .g-user-name {
    display: none;
  }

  .g-user {
    padding: 4px;
  }

  .g-icon-btn {
    width: 38px;
    height: 38px;
  }
}
</style>
