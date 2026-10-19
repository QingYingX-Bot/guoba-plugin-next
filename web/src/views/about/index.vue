<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Modal,
  Row,
  Space,
  Tag,
} from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import { apiRestartBot, apiRestartGuoba } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { API_PREFIX, GUOBA_VERSION, HOST_NAME, ICP_NO, IS_V2, YUNZAI_VERSION } from '@/utils/env'

const auth = useAuthStore()

const restarting = ref('')

const links = [
  {
    title: '当前仓库（QingYingX）',
    desc: '本面板实际运行的 fork，改动在此',
    url: 'https://github.com/QingYingX-Bot/guoba-plugin-next',
    icon: 'ant-design:github-outlined',
  },
  {
    title: '上游仓库（cchanlan）',
    desc: 'guoba-plugin-next 上游，更新来源',
    url: 'https://github.com/cchanlan/guoba-plugin-next',
    icon: 'ant-design:code-outlined',
  },
  {
    title: '原版仓库（guoba-yunzai）',
    desc: 'Guoba-Plugin 最原始项目',
    url: 'https://github.com/guoba-yunzai/guoba-plugin',
    icon: 'ant-design:link-outlined',
  },
  {
    title: '插件索引',
    desc: 'Yunzai 插件收录列表',
    url: 'https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index',
    icon: 'ant-design:appstore-outlined',
  },
]

const NOWRAP = { whiteSpace: 'nowrap' } as const
const WRAP = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const

/** 版本四卡 */
const versionCards = computed(() => [
  { label: '锅巴版本', value: `v${GUOBA_VERSION}`, icon: 'ant-design:appstore-outlined', color: '#b57bd8' },
  { label: `${HOST_NAME} 版本`, value: YUNZAI_VERSION, icon: 'ant-design:rocket-outlined', color: '#4c8dff' },
  { label: '接口版本', value: API_PREFIX, icon: 'ant-design:api-outlined', color: '#3cc2a0' },
  { label: '登录账号', value: String(auth.user?.username ?? '-'), icon: 'ant-design:user-outlined', color: '#e0a34a' },
])

const envInfo = computed<EnvItem[]>(() => [
  { label: 'Bot 昵称', value: auth.user?.realName || '-' },
  { label: 'UA', value: navigator.userAgent, span: 2, wrap: true },
])

interface EnvItem {
  label: string
  value: string
  span?: number
  wrap?: boolean
}

function open(url: string) {
  window.open(url, '_blank', 'noopener')
}

function confirmRestart(type: 'guoba' | 'bot') {
  const isBot = type === 'bot'
  Modal.confirm({
    title: isBot ? '重启 Bot？' : '重启锅巴服务？',
    content: isBot
      ? '重启期间 Bot 会短暂离线，正在进行的任务会中断。'
      : '只重启锅巴后台服务，Bot 本体不受影响。',
    okText: '重启',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      restarting.value = type
      try {
        await (isBot ? apiRestartBot() : apiRestartGuoba())
      } finally {
        restarting.value = ''
      }
    },
  })
}
</script>

<template>
  <div class="g-page">
    <div class="g-page-head">
      <h2 class="g-page-title">关于</h2>
      <p class="g-page-desc">锅巴是 Yunzai-Bot 的可视化管理面板。</p>
    </div>

    <Card :bordered="false" class="g-about-hero">
      <div class="g-about-top">
        <img src="/logo.png" alt="Guoba" class="g-about-logo" />
        <div>
          <h3 class="g-about-name">
            锅巴插件
            <Tag color="gold">v{{ GUOBA_VERSION }}</Tag>
            <Tag color="blue">{{ HOST_NAME }} {{ YUNZAI_VERSION }}</Tag>
            <Tag v-if="IS_V2" color="orange">V2 兼容模式</Tag>
          </h3>
          <p class="g-about-desc">
            兼容 Miao-Yunzai（V3、V4）、TRSS-Yunzai 与 JiuLi，为 Yunzai 及其插件提供网页端配置能力。
          </p>
        </div>
      </div>
    </Card>

    <Card :bordered="false" title="运行环境" class="g-section">
      <Row :gutter="[16, 16]">
        <Col v-for="item in versionCards" :key="item.label" :xs="12" :sm="12" :md="6">
          <div class="g-metric">
            <span class="g-metric-icon" :style="{ color: item.color, background: `${item.color}1f` }">
              <GIcon :icon="item.icon" :size="18" />
            </span>
            <div class="g-metric-body">
              <div class="g-metric-label">{{ item.label }}</div>
              <div class="g-metric-value g-selectable">{{ item.value }}</div>
            </div>
          </div>
        </Col>
      </Row>
      <Descriptions
        class="g-about-env"
        :column="{ xs: 1, sm: 2 }"
        size="small"
        bordered
        :label-style="NOWRAP"
      >
        <DescriptionsItem
          v-for="item in envInfo"
          :key="item.label"
          :label="item.label"
          :span="item.span"
          :content-style="item.wrap ? WRAP : NOWRAP"
        >
          <span class="g-about-val g-selectable" :class="{ 'is-ua': item.wrap }">{{ item.value }}</span>
        </DescriptionsItem>
      </Descriptions>
    </Card>

    <Card :bordered="false" title="相关链接" class="g-section">
      <Row :gutter="[16, 16]">
        <Col v-for="link in links" :key="link.url" :xs="24" :sm="12" :md="6">
          <div class="g-link-card" @click="open(link.url)">
            <GIcon :icon="link.icon" :size="18" class="g-link-icon" />
            <div class="g-link-text">
              <div class="g-link-title">{{ link.title }}</div>
              <div class="g-link-desc">{{ link.desc }}</div>
            </div>
            <GIcon icon="ant-design:right-outlined" :size="12" class="g-link-arrow" />
          </div>
        </Col>
      </Row>
    </Card>

    <Card :bordered="false" title="维护操作" class="g-section">
      <p class="g-ops-tip">改完配置若未生效，可尝试重启对应服务。</p>
      <Space>
        <Button :loading="restarting === 'guoba'" @click="confirmRestart('guoba')">
          <GIcon icon="ant-design:sync-outlined" :size="13" />
          <span class="g-btn-text">重启锅巴</span>
        </Button>
        <Button danger :loading="restarting === 'bot'" @click="confirmRestart('bot')">
          <GIcon icon="ant-design:poweroff-outlined" :size="13" />
          <span class="g-btn-text">重启 Bot</span>
        </Button>
      </Space>
    </Card>

    <p v-if="ICP_NO" class="g-about-icp">{{ ICP_NO }}</p>
  </div>
</template>

<style scoped>
.g-page-head {
  margin-bottom: 14px;
}

.g-section {
  margin-bottom: 16px;
}

.g-about-hero {
  margin-bottom: 16px;
  background:
    radial-gradient(circle at 90% 10%, var(--g-brand-glow), transparent 46%),
    var(--g-bg-card);
}

.g-about-top {
  display: flex;
  align-items: center;
  gap: 16px;
}

.g-about-logo {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.g-about-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: var(--g-text);
}

.g-about-desc {
  margin: 0;
  font-size: 13px;
  color: var(--g-text-sub);
}

.g-metric {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--g-bg-soft);
}

.g-metric-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  flex-shrink: 0;
}

.g-metric-label {
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-metric-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--g-text);
  white-space: nowrap;
}

.g-about-env {
  margin-top: 16px;
  overflow-x: auto;
}

.g-about-val {
  white-space: nowrap;
}

.g-about-val.is-ua {
  white-space: normal;
  overflow-wrap: anywhere;
}

.g-link-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--g-bg-soft);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  height: 100%;
}

.g-link-card:hover {
  background: var(--g-bg-soft);
  border-color: var(--g-brand);
}

.g-link-icon {
  color: var(--g-brand);
  flex-shrink: 0;
}

.g-link-text {
  flex: 1;
  min-width: 0;
}

.g-link-title {
  font-size: 13px;
  color: var(--g-text);
}

.g-link-desc {
  font-size: 12px;
  color: var(--g-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.g-link-arrow {
  color: var(--g-text-dim);
  flex-shrink: 0;
}

.g-ops-tip {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--g-text-dim);
}

.g-btn-text {
  margin-left: 5px;
}

.g-about-icp {
  margin-top: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--g-text-dim);
}
</style>
