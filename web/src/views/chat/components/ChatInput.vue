<script setup lang="ts">
/**
 * 底部输入区。
 *
 * 普通适配器（OneBot 系）两档：「普通」文本 + 图片，「Raw」直接把 JSON 段数组交给适配器
 * —— 相当于在插件里写 `e.reply([...])`。
 *
 * 普通 / MD消息 / Ark / 富媒体，外加一个「msg_id 回复」勾选。官bot 对主动消息有额度与
 * 权限限制，勾上这个会把最近一条收到的消息的 msg_id 带在消息体上，走被动消息 ——
 * 那是面板里最稳的发送方式。（引用条上的口径由消息右键菜单决定，见 ChatReplyTarget。）
 *
 * 图片以原始 File 对象提交（multipart），不再转 base64 —— 共享 TRSS 端口时 body
 * 解析器是宿主的 express.json，默认 100kb，一张图塞进 JSON 就 413 了。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import GIcon from '@/components/GIcon.vue'
import type { ChatReplyTarget, ChatSendMode, ChatSendPayload } from '@/api'
import { filesFromHtml } from '@/utils/clipboard'

/** 预览用的图片，objectURL 由组件负责回收 */
interface PickedImage {
  file: File
  url: string
}

/** 右键 @ 攒起来的待 @ 对象，发送时转成 at 段 */
interface PickedAt {
  qq: string
  name: string
}

/** 发送档位。前两档所有适配器都有，后三档只有 QQBot 给 */
type SendMode = ChatSendMode

const props = defineProps<{
  disabled: boolean
  sending: boolean
  maxImages: number
  /** 当前会话是不是 QQ 官方机器人，是的话多给 MD / Ark / 富媒体三档 */
  qqbot: boolean
  /** 引用的那条，父层给摘要与口径，这里只负责显示与清除 */
  reply: ChatReplyTarget | null
}>()

const emit = defineEmits<{
  send: [payload: ChatSendPayload]
  cancelReply: []
}>()

const RAW_PLACEHOLDER = `[{"type": "text", "text": "hello"}]`

/** Ark 模板。 */
interface ArkField {
  key: string
  label: string
  placeholder: string
}

interface ArkTemplate {
  id: number
  name: string
  fields: ArkField[]
  /** 模板 23 独有：一个可重复的「描述 + 链接」列表 */
  list?: boolean
}

const ARK_TEMPLATES: ArkTemplate[] = [
  {
    id: 23,
    name: '23 · 列表卡片',
    fields: [
      { key: '#DESC#', label: '描述', placeholder: '描述文本' },
      { key: '#PROMPT#', label: '提示', placeholder: '提示文本' },
    ],
    list: true,
  },
  {
    id: 24,
    name: '24 · 图文卡片',
    fields: [
      { key: '#DESC#', label: '描述', placeholder: '描述文本' },
      { key: '#PROMPT#', label: '提示', placeholder: '提示文本' },
      { key: '#TITLE#', label: '标题', placeholder: '标题' },
      { key: '#METADESC#', label: '详情', placeholder: '详情描述' },
      { key: '#IMG#', label: '图片', placeholder: 'https://图片链接' },
      { key: '#LINK#', label: '链接', placeholder: 'https://跳转链接' },
      { key: '#SUBTITLE#', label: '来源', placeholder: '来源 / 子标题' },
    ],
  },
  {
    id: 37,
    name: '37 · 大图卡片',
    fields: [
      { key: '#PROMPT#', label: '提示', placeholder: '提示文本' },
      { key: '#METATITLE#', label: '标题', placeholder: '标题' },
      { key: '#METASUBTITLE#', label: '子标题', placeholder: '子标题' },
      { key: '#METACOVER#', label: '封面图', placeholder: 'https://图片链接（975x540）' },
      { key: '#METAURL#', label: '链接（可选）', placeholder: 'https://跳转链接（需报备域名）' },
    ],
  },
]

const mode = ref<SendMode>('normal')
const text = ref('')
const raw = ref('')
const images = ref<PickedImage[]>([])
/** 右键 @ 攒起来的人，发送时转 at 段 */
const ats = ref<PickedAt[]>([])
/** 富媒体档选中的文件，图片之外还有视频 / 音频 / 任意文件 */
const mediaFiles = ref<File[]>([])
/** QQBot：勾上就引用最近一条收到的消息发，走被动消息 */
const useMsgIdReply = ref(false)

/* ---- Ark 表单 ---- */
const arkTemplate = ref(23)
const arkValues = ref<Record<string, string>>({})
/** 模板 23 的 #LIST#，一行一条，写成「描述|链接」 */
const arkListText = ref('')

/** 一次最多 @ 几个人，跟图片一样给个上限 */
const MAX_ATS = 5

const inputEl = ref<any>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const mediaEl = ref<HTMLInputElement | null>(null)

const currentArk = computed(() => ARK_TEMPLATES.find((t) => t.id === arkTemplate.value) ?? ARK_TEMPLATES[0])

/** 组装 Ark 参数。空字段不发 —— 官方对空 value 会直接报参数错误 */
function buildArkPayload(): string {
  const tpl = currentArk.value
  const kv: Array<Record<string, unknown>> = []
  for (const f of tpl.fields) {
    const v = (arkValues.value[f.key] ?? '').trim()
    if (v) kv.push({ key: f.key, value: v })
  }
  if (tpl.list) {
    const items = arkListText.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [desc = '', link = ''] = line.split('|').map((s) => s.trim())
        const obj: Array<{ key: string; value: string }> = [{ key: 'desc', value: desc }]
        if (link) obj.push({ key: 'link', value: link })
        return { obj_kv: obj }
      })
      .filter((o) => o.obj_kv[0].value)
    if (items.length) kv.push({ key: '#LIST#', obj: items })
  }
  return JSON.stringify({ template_id: tpl.id, kv })
}

/** Ark 至少要填一个非空字段，否则后端也会拦 */
const arkFilled = computed(() => {
  const tpl = currentArk.value
  if (tpl.fields.some((f) => (arkValues.value[f.key] ?? '').trim())) return true
  return tpl.list ? !!arkListText.value.trim() : false
})

const canSend = computed(() => {
  if (props.disabled || props.sending) return false
  switch (mode.value) {
    case 'raw':
      return !!raw.value.trim()
    case 'markdown':
      return !!text.value.trim()
    case 'ark':
      return arkFilled.value
    case 'media':
      return !!mediaFiles.value.length
    default:
      return !!text.value.trim() || !!images.value.length
  }
})

/** 引用了就把焦点交给输入框，点完「引用」能直接打字 */
watch(
  () => props.reply,
  (v) => {
    // Ark / 富媒体档没有文本输入框，引用对它们照样有效（后端会给每条都带上 reply 段），
    // 但没什么可聚焦的，别把人家填到一半的表单切走
    if (!v || mode.value === 'ark' || mode.value === 'media') return
    nextTick(() => inputEl.value?.focus())
  },
)

/** 切回普通适配器时把 QQBot 专有的档位收回来 */
watch(
  () => props.qqbot,
  (v) => {
    if (!v && (mode.value === 'markdown' || mode.value === 'ark' || mode.value === 'media')) {
      mode.value = 'normal'
    }
  },
)

function submit() {
  if (!canSend.value) return
  if (mode.value === 'raw') {
    // 先在本地挡一次非法 JSON，省一趟请求，也免得后端报错时看不出是哪儿的问题
    try {
      JSON.parse(raw.value)
    } catch (e: any) {
      message.error(`JSON 解析失败：${e?.message ?? e}`)
      return
    }
  }
  emit('send', {
    mode: mode.value,
    text: text.value,
    raw: raw.value,
    images: images.value.map((i) => i.file),
    ats: ats.value,
    ark: mode.value === 'ark' ? buildArkPayload() : '',
    files: mode.value === 'media' ? [...mediaFiles.value] : [],
    useMsgIdReply: useMsgIdReply.value,
  })
}

/** 发送成功后由父层调，失败时内容留着好改 */
function reset() {
  switch (mode.value) {
    case 'raw':
      raw.value = ''
      break
    case 'markdown':
      text.value = ''
      break
    case 'media':
      mediaFiles.value = []
      break
    case 'ark':
      // Ark 是一张卡片模板，发完保留内容，想再发一次不用重填
      break
    default:
      text.value = ''
      clearImages()
      ats.value = []
  }
}

/** 右键 @ 某个人：去重、限数，重复了只把输入焦点捞回来 */
function addAt(one: { qq: string; name: string }) {
  if (!one.qq) return
  if (ats.value.some((a) => a.qq === one.qq)) {
    nextTick(() => inputEl.value?.focus())
    return
  }
  if (ats.value.length >= MAX_ATS) {
    message.warning(`一次最多 @ ${MAX_ATS} 个人`)
    return
  }
  // at 段只有普通档会拼进消息，别的档位（MD / Ark / 富媒体）后端直接忽略，
  // 与其攒一个发不出去的 @，不如切回普通档
  if (mode.value !== 'normal') mode.value = 'normal'
  ats.value.push(one)
  nextTick(() => inputEl.value?.focus())
}

function clearImages() {
  for (const img of images.value) URL.revokeObjectURL(img.url)
  images.value = []
}

function onEnter(e: KeyboardEvent) {
  // Shift+Enter 换行，Ctrl/Cmd+Enter 也当发送（Raw / MD 档多行内容更顺手）
  if (e.shiftKey) return
  e.preventDefault()
  submit()
}

/* ---------------- 图片 ---------------- */

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  addFiles(Array.from(input.files ?? []))
  // 清掉才能连着选同一个文件两次
  input.value = ''
}

async function onPaste(e: ClipboardEvent) {
  const data = e.clipboardData
  if (!data) return
  const files = Array.from(data.items)
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f)
  if (files.length) {
    e.preventDefault()
    addFiles(files)
    return
  }

  /**
   * 剪贴板里没有文件项，但 HTML 里有图 —— 面板在 http 下复制消息就是这种形状
   * （见 utils/clipboard 的 copyHtml）。自己把图抠出来，文字接着往输入框里补。
   */
  const html = data.getData('text/html')
  if (!html.includes('<img')) return
  e.preventDefault()
  const picked = await filesFromHtml(html, props.maxImages)
  if (picked.length) addFiles(picked)
  else message.warning('剪贴板里的图片读不出来，只粘了文字')
  // 接管了粘贴就得自己插文字。光标位置拿不到就追加到末尾，日常够用
  const plain = data.getData('text/plain')
  if (plain) text.value += plain
}

function addFiles(files: File[]) {
  const room = props.maxImages - images.value.length
  if (room <= 0) {
    message.warning(`最多带 ${props.maxImages} 张图`)
    return
  }
  files.slice(0, room).forEach((file) => {
    images.value.push({ file, url: URL.createObjectURL(file) })
  })
}

/* ---------------- 富媒体 ---------------- */

/** 富媒体只发一个文件，重复选就替换 */
function onMediaChange(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  if (!picked.length) return
  mediaFiles.value = picked.slice(0, props.maxImages)
  if (picked.length > props.maxImages) message.warning(`一次最多 ${props.maxImages} 个文件`)
}

/** 给选中文件配个图标，图片 / 视频 / 音频 / 其它一眼能分 */
function mediaIcon(file: File) {
  const type = file.type || ''
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
    return 'ant-design:picture-outlined'
  }
  if (type.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) {
    return 'ant-design:video-camera-outlined'
  }
  if (type.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return 'ant-design:audio-outlined'
  }
  return 'ant-design:file-outlined'
}

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 各档的说明文案 */
const TIP: Record<SendMode, string> = {
  normal: '真的会发到 QQ 上',
  raw: '段数组直接交给适配器，等价于插件里的 e.reply([...])',
  markdown: 'MD 消息：正文按 Markdown 渲染，官bot 需要对应权限',
  ark: 'Ark 卡片：模板字段由官方审核，空字段不发',
  media: '富媒体：直接把文件交给官bot 上传，走富媒体通道',
}

const tipText = computed(() => TIP[mode.value] ?? '')

defineExpose({
  reset,
  focus: () => inputEl.value?.focus(),
  /** 右键 @ 某个人，由页面调 */
  addAt,
  /** 按钮段的 input 会往输入框里填文本，由页面调 */
  setText: (v: string) => {
    mode.value = 'normal'
    text.value = v
    nextTick(() => inputEl.value?.focus())
  },
})
</script>

<template>
  <div class="g-cin" :class="{ 'is-disabled': disabled }">
    <!-- 档位 tab 压在最上，跟参考图一样分两栏 -->
    <div class="g-cin-tabs">
      <a-radio-group v-if="qqbot" v-model:value="mode" size="small" button-style="solid">
        <a-radio-button value="normal">普通</a-radio-button>
        <a-radio-button value="markdown">MD消息</a-radio-button>
        <a-radio-button value="ark">Ark</a-radio-button>
        <a-radio-button value="media">富媒体</a-radio-button>
      </a-radio-group>
      <a-radio-group v-else v-model:value="mode" size="small" button-style="solid">
        <a-radio-button value="normal">普通</a-radio-button>
        <a-radio-button value="raw">发送 Raw</a-radio-button>
      </a-radio-group>

      <span class="g-cin-gap" />

      <!-- 官bot 的主动消息有限制，勾上就走引用（被动消息） -->
      <a-checkbox v-if="qqbot" v-model:checked="useMsgIdReply" class="g-cin-replyid">
        msg_id 回复
      </a-checkbox>
      <span class="g-cin-tip">{{ tipText }}</span>
    </div>

    <!-- 引用条：跟 QQ 一样压在输入框上方，×撤掉。三种口径发出去的样子不一样，标出来 -->
    <div v-if="reply" class="g-cin-reply">
      <GIcon icon="ant-design:rollback-outlined" :size="12" />
      <span v-if="reply.mode !== 'quote'" class="g-cin-reply-mode">
        {{ reply.mode === 'eventId' ? 'event_id 回复' : 'msg_id 回复' }}
      </span>
      <span class="g-cin-reply-name">{{ reply.name }}</span>
      <span class="g-cin-reply-text">{{ reply.text }}</span>
      <button type="button" class="g-cin-reply-x" @click="emit('cancelReply')">
        <GIcon icon="ant-design:close-outlined" :size="11" />
      </button>
    </div>

    <!-- 待 @ 的人：右键菜单攒起来的，发送时转成真 at 段。只有普通档会带上它们 -->
    <div v-if="ats.length && mode === 'normal'" class="g-cin-ats">
      <span v-for="(a, i) in ats" :key="a.qq" class="g-cin-at">
        @{{ a.name || a.qq }}
        <button type="button" class="g-cin-at-x" @click="ats.splice(i, 1)">
          <GIcon icon="ant-design:close-outlined" :size="9" />
        </button>
      </span>
      <!--
        官bot 只认 markdown 正文里的 `<@openid>`，纯文本档的 at 段会被 QQBot-Plugin
        直接丢掉（makeMsg 里 `case "at": continue`）。所以带了 @ 的普通消息发出去会
        是 MD 消息 —— 提前说一声，免得用户以为选错了档。
      -->
      <span v-if="qqbot" class="g-cin-at-tip">带 @ 的消息会按 MD 发送</span>
    </div>

    <div v-if="mode === 'normal' && images.length" class="g-cin-imgs">
      <div v-for="(img, i) in images" :key="img.url" class="g-cin-img">
        <img :src="img.url" alt="" />
        <span class="g-cin-img-del" @click="images.splice(i, 1)">
          <GIcon icon="ant-design:close-outlined" :size="10" />
        </span>
      </div>
    </div>

    <!-- 普通 / MD 共用输入框，切档时内容留着 -->
    <a-textarea
      v-if="mode === 'normal' || mode === 'markdown'"
      ref="inputEl"
      v-model:value="text"
      :disabled="disabled"
      :placeholder="
        mode === 'markdown'
          ? 'Markdown 正文，例如 # 标题 / **加粗** / [文字](链接)；Enter 发送，Shift+Enter 换行'
          : '输入消息，Enter 发送，Shift+Enter 换行；可粘贴或选择图片…'
      "
      :auto-size="{ minRows: 2, maxRows: 6 }"
      :bordered="false"
      :class="{ 'g-cin-mono': mode === 'markdown' }"
      @keydown.enter="onEnter"
      @paste="onPaste"
    />
    <a-textarea
      v-else-if="mode === 'raw'"
      ref="inputEl"
      v-model:value="raw"
      :disabled="disabled"
      :placeholder="`段数组 JSON，例如 ${RAW_PLACEHOLDER}；Enter 发送，Shift+Enter 换行`"
      :auto-size="{ minRows: 3, maxRows: 8 }"
      :bordered="false"
      class="g-cin-raw"
      @keydown.enter="onEnter"
    />

    <!-- Ark：模板 + 字段。字段名沿用官方模板的占位符，跟 Web-Adapter 一致 -->
    <div v-else-if="mode === 'ark'" class="g-cin-ark">
      <div class="g-cin-ark-head">
        <span class="g-cin-ark-label">模板</span>
        <a-select v-model:value="arkTemplate" size="small" style="width: 170px">
          <a-select-option v-for="t in ARK_TEMPLATES" :key="t.id" :value="t.id">
            {{ t.name }}
          </a-select-option>
        </a-select>
        <span class="g-cin-ark-tip">留空的字段不会发出去</span>
      </div>
      <div class="g-cin-ark-fields">
        <div v-for="f in currentArk.fields" :key="f.key" class="g-cin-ark-row">
          <span class="g-cin-ark-key">{{ f.key }}</span>
          <a-input
            v-model:value="arkValues[f.key]"
            size="small"
            :placeholder="f.placeholder"
            :disabled="disabled"
          />
        </div>
        <div v-if="currentArk.list" class="g-cin-ark-row is-block">
          <span class="g-cin-ark-key">#LIST#</span>
          <a-textarea
            v-model:value="arkListText"
            size="small"
            :auto-size="{ minRows: 2, maxRows: 4 }"
            placeholder="一行一条：描述|链接（链接可省），例如：官网|https://example.com"
            :disabled="disabled"
          />
        </div>
      </div>
    </div>

    <!-- 富媒体：选文件，类型按 MIME / 扩展名自动判定 -->
    <div v-else-if="mode === 'media'" class="g-cin-media">
      <div v-if="mediaFiles.length" class="g-cin-media-list">
        <div v-for="(f, i) in mediaFiles" :key="`${f.name}-${i}`" class="g-cin-media-item">
          <GIcon :icon="mediaIcon(f)" :size="15" />
          <span class="g-cin-media-name">{{ f.name }}</span>
          <span class="g-cin-media-size">{{ prettySize(f.size) }}</span>
          <button type="button" class="g-cin-media-x" @click="mediaFiles.splice(i, 1)">
            <GIcon icon="ant-design:close-outlined" :size="11" />
          </button>
        </div>
      </div>
      <a-button size="small" :disabled="disabled" @click="mediaEl?.click()">
        <GIcon icon="ant-design:upload-outlined" :size="13" />
        选择文件
      </a-button>
      <input ref="mediaEl" type="file" multiple hidden @change="onMediaChange" />
      <span class="g-cin-media-tip">图片 / 视频 / 音频 / 其它文件都行，按类型自动选段</span>
    </div>

    <div class="g-cin-acts">
      <button
        v-if="mode === 'normal'"
        type="button"
        class="g-cin-imgbtn"
        :disabled="disabled || images.length >= maxImages"
        :title="images.length >= maxImages ? `最多 ${maxImages} 张` : '添加图片'"
        @click="fileEl?.click()"
      >
        <GIcon icon="ant-design:picture-outlined" :size="17" />
      </button>
      <input ref="fileEl" type="file" accept="image/*" multiple hidden @change="onFileChange" />
      <span class="g-cin-gap" />
      <button
        type="button"
        class="g-cin-send"
        :class="{ 'is-sending': sending }"
        :disabled="!canSend"
        title="发送消息"
        @click="submit"
      >
        <GIcon icon="ant-design:send-outlined" :size="17" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.g-cin {
  border-top: 1px solid var(--g-border);
  padding: 8px 10px 8px;
}

.g-cin.is-disabled {
  opacity: 0.6;
}

.g-cin-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.g-cin-gap {
  flex: 1;
}

.g-cin-tip {
  color: var(--g-text-dim);
  font-size: 12px;
}

.g-cin-replyid {
  font-size: 12px;
  white-space: nowrap;
}

.g-cin-reply {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 4px 8px;
  border-left: 2px solid var(--g-brand);
  border-radius: 0 6px 6px 0;
  background: var(--g-bg-soft);
  color: var(--g-text-dim);
  font-size: 12px;
}

.g-cin-reply-mode {
  flex: none;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--g-brand-soft);
  color: var(--g-brand);
  font-size: 11px;
}

.g-cin-reply-name {
  flex: none;
  color: var(--g-text-sub);
}

.g-cin-reply-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-cin-reply-x {
  flex: none;
  display: inline-flex;
  padding: 0 2px;
  border: none;
  background: none;
  color: var(--g-text-dim);
  cursor: pointer;
}

.g-cin-reply-x:hover {
  color: var(--g-danger);
}

.g-cin-ats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.g-cin-at {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--g-brand-soft);
  color: var(--g-brand);
  font-size: 12px;
}

.g-cin-at-x {
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
}

.g-cin-at-tip {
  align-self: center;
  color: var(--g-text-dim);
  font-size: 11px;
}

.g-cin-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.g-cin-img {
  position: relative;
  width: 56px;
  height: 56px;
}

.g-cin-img img {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  border: 1px solid var(--g-border);
  object-fit: cover;
}

.g-cin-img-del {
  position: absolute;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--g-bg-elevated);
  border: 1px solid var(--g-border);
  color: var(--g-text-sub);
  cursor: pointer;
}

.g-cin-img-del:hover {
  color: var(--g-danger);
  border-color: var(--g-danger);
}

/* Raw 档用等宽字体，JSON 更好读 */
.g-cin-raw :deep(textarea),
.g-cin-mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

/* ---------------- Ark ---------------- */

.g-cin-ark {
  margin-bottom: 2px;
}

.g-cin-ark-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.g-cin-ark-label {
  color: var(--g-text-sub);
  font-size: 12px;
}

.g-cin-ark-tip {
  color: var(--g-text-dim);
  font-size: 12px;
}

.g-cin-ark-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 6px 10px;
}

.g-cin-ark-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.g-cin-ark-row.is-block {
  grid-column: 1 / -1;
  align-items: flex-start;
}

.g-cin-ark-key {
  flex: none;
  width: 96px;
  color: var(--g-text-dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-cin-ark-row.is-block .g-cin-ark-key {
  padding-top: 5px;
}

.g-cin-ark-row :deep(.ant-input),
.g-cin-ark-row :deep(textarea) {
  font-size: 12px;
}

/* ---------------- 富媒体 ---------------- */

.g-cin-media {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 2px;
}

.g-cin-media-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.g-cin-media-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--g-border);
  border-radius: 6px;
  background: var(--g-bg-soft);
  font-size: 12px;
}

.g-cin-media-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.g-cin-media-size {
  flex: none;
  color: var(--g-text-dim);
}

.g-cin-media-x {
  flex: none;
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  color: var(--g-text-dim);
  cursor: pointer;
}

.g-cin-media-x:hover {
  color: var(--g-danger);
}

.g-cin-media-tip {
  color: var(--g-text-dim);
  font-size: 12px;
}

.g-cin-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.g-cin-imgbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--g-text-sub);
  cursor: pointer;
}

.g-cin-imgbtn:hover:not(:disabled) {
  background: var(--g-bg-soft);
  color: var(--g-brand);
}

.g-cin-imgbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 圆形发送键，跟参考图一致 */
.g-cin-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--g-brand);
  color: #fff;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}

.g-cin-send:hover:not(:disabled) {
  transform: scale(1.06);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.g-cin-send:active:not(:disabled) {
  transform: scale(0.96);
}

.g-cin-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.g-cin-send.is-sending {
  animation: g-cin-pulse 1s infinite;
}

@keyframes g-cin-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
