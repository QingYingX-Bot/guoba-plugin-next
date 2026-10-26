/**
 * 文件管理的状态与行为。
 *
 * PC 和手机两套界面（components/FilesPcView.vue、components/FilesMobileView.vue）
 * 共用这一份逻辑，只是渲染方式不同 —— 否则两套各写一遍，删目录、清选择这类细节
 * 迟早会漂移成两个样子。
 *
 * 返回的 vm 用 reactive 包过：子组件通过 prop 拿到后，模板里直接写 `vm.list`
 * 就是解包后的值，不用到处 `.value`。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  apiCreateMediaTicket,
  apiFileCreate,
  apiFileDelete,
  apiFileDeleteBatch,
  apiFileDirSize,
  apiFileList,
  apiFileMkdir,
  apiFileRead,
  apiFileRename,
  apiFileSave,
  apiFileUpload,
  fileDownloadDirUrl,
  fileDownloadUrl,
  type FsFile,
} from '@/api'

/**
 * 下载/预览走短期媒体票据：URL 里只放票据，正式令牌和二级密码凭证都不进 URL。
 * 票据 5 分钟过期，页面停留久了要换一张。
 */
const TICKET_REFRESH_MS = 4 * 60 * 1000

/** 图片扩展名，单击直接预览 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])

/** 二进制扩展名：没法在页面里编辑，只能下载 */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif',
  'zip', 'gz', 'tar', '7z', 'rar', 'xz', 'bz2',
  'exe', 'dll', 'so', 'bin', 'dat', 'db', 'sqlite', 'sqlite3',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'avi', 'mkv', 'mov', 'webm', 'flac', 'wav',
  'pdf', 'jar', 'pyc', 'class', 'node',
])

/** 文本编辑上限，跟后端 read 的 2MB 一致 */
const MAX_EDIT_SIZE = 2 * 1024 * 1024

/** 已算出的文件夹占用，key 是相对路径；loading 表示正在算 */
export interface DirSize {
  loading: boolean
  size?: number
  files?: number
  dirs?: number
  partial?: boolean
}

export function useFileManager() {
  const mediaTicket = ref('')
  let ticketTimer: number | undefined

  async function refreshTicket() {
    try {
      mediaTicket.value = (await apiCreateMediaTicket('file')).ticket
    } catch {
      // 取不到就保持空票据，错误由请求层提示
    }
  }

  /** 当前目录，相对 Yunzai 根；空串 = 根 */
  const currentPath = ref('')
  const list = ref<FsFile[]>([])
  const loading = ref(false)

  /* 预览 / 编辑 */
  const viewOpen = ref(false)
  const viewMode = ref<'text' | 'image' | ''>('')
  const viewPath = ref('')
  const viewName = ref('')
  const viewContent = ref('')
  const editing = ref(false)
  const saving = ref(false)

  /* 新建 */
  const createOpen = ref(false)
  const createType = ref<'dir' | 'file'>('dir')
  const createName = ref('')

  /* 重命名 */
  const renameOpen = ref(false)
  const renamePath = ref('')
  const renameName = ref('')

  /* 上传：input 元素在父页面里，这里只留引用 */
  const uploadEl = ref<HTMLInputElement | null>(null)
  const uploadDirEl = ref<HTMLInputElement | null>(null)
  const uploading = ref(false)
  /** 上传文件夹时的进度文案，如 12/120；空串表示没在传 */
  const uploadHint = ref('')

  const dirSizes = ref<Record<string, DirSize>>({})
  /** 「算全部」正在跑 */
  const calcAllRunning = ref(false)

  /* ---------------- 多选 / 批量删除 ---------------- */

  /** 当前勾选的条目名；同一目录内名字唯一，直接拿名字当 key */
  const selectedNames = ref<string[]>([])
  const selected = computed(() => new Set(selectedNames.value))
  const allSelected = computed(
    () => list.value.length > 0 && selectedNames.value.length === list.value.length,
  )
  /** 手机端的「多选模式」：开启后点卡片只勾选，不进目录也不预览 */
  const selectMode = ref(false)

  function isSelected(f: FsFile) {
    return selected.value.has(f.name)
  }

  function toggleSelect(f: FsFile) {
    const i = selectedNames.value.indexOf(f.name)
    if (i >= 0) selectedNames.value.splice(i, 1)
    else selectedNames.value.push(f.name)
  }

  function toggleSelectAll() {
    selectedNames.value = allSelected.value ? [] : list.value.map((f) => f.name)
  }

  function clearSelection() {
    selectedNames.value = []
  }

  function exitSelectMode() {
    selectMode.value = false
    clearSelection()
  }

  /** 能不能在页面里编辑：非目录、不超 2MB、扩展名不是二进制 */
  function isEditable(f: FsFile) {
    if (f.isDir) return false
    if (f.size > MAX_EDIT_SIZE) return false
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    return !BINARY_EXTS.has(ext)
  }

  /** 面包屑，根不显示在列表里 */
  const breadcrumbs = computed(() => {
    const parts = currentPath.value ? currentPath.value.split('/') : []
    return parts.map((p, i) => ({ name: p, path: parts.slice(0, i + 1).join('/') }))
  })

  /** 上一级路径，根目录的上一级还是根 */
  const parentPath = computed(() => currentPath.value.split('/').slice(0, -1).join('/'))

  function isImage(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return IMAGE_EXTS.has(ext)
  }

  function fmtSize(size: number) {
    if (size >= 1 << 30) return `${(size / (1 << 30)).toFixed(2)} GB`
    if (size >= 1 << 20) return `${(size / (1 << 20)).toFixed(2)} MB`
    if (size >= 1 << 10) return `${(size / (1 << 10)).toFixed(1)} KB`
    return `${size} B`
  }

  function fmtTime(t: number) {
    if (!t) return ''
    const d = new Date(t * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  /** 当前目录 + 名称 → 相对路径 */
  function joinPath(name: string) {
    return currentPath.value ? `${currentPath.value}/${name}` : name
  }

  async function load() {
    if (loading.value) return
    loading.value = true
    // 列表换了，之前勾中的名字就不再有意义；留着会在下一次批量删除时误删同名项
    clearSelection()
    try {
      list.value = await apiFileList(currentPath.value)
    } catch {
      // showError 已关，错误在具体操作里露
    } finally {
      loading.value = false
    }
  }

  function goBreadcrumb(path: string) {
    currentPath.value = path
    load()
  }

  /* ---------------- 预览 / 编辑 ---------------- */

  /** 单击：文件夹进入，图片直接预览，其余读文本预览 */
  async function onOpen(f: FsFile) {
    if (f.isDir) {
      currentPath.value = joinPath(f.name)
      load()
      return
    }
    const rel = joinPath(f.name)
    if (isImage(f.name)) {
      viewMode.value = 'image'
      viewPath.value = rel
      viewName.value = f.name
      viewContent.value = ''
      editing.value = false
      viewOpen.value = true
      return
    }
    try {
      const data = await apiFileRead(rel)
      viewMode.value = 'text'
      viewPath.value = rel
      viewName.value = f.name
      viewContent.value = data.content
      editing.value = false
      viewOpen.value = true
    } catch (e: any) {
      message.error(e?.message ?? '读取失败')
    }
  }

  /** 「编辑」入口：直接进文本编辑态 */
  async function onEdit(f: FsFile) {
    if (f.isDir) return
    const rel = joinPath(f.name)
    try {
      const data = await apiFileRead(rel)
      viewMode.value = 'text'
      viewPath.value = rel
      viewName.value = f.name
      viewContent.value = data.content
      editing.value = true
      viewOpen.value = true
    } catch (e: any) {
      message.error(e?.message ?? '读取失败')
    }
  }

  async function savePreview() {
    saving.value = true
    try {
      await apiFileSave({ path: viewPath.value, content: viewContent.value })
      viewOpen.value = false
      message.success('已保存')
      load()
    } catch {
      // 错误已由请求层弹出
    } finally {
      saving.value = false
    }
  }

  /** 图片 / 文本下载地址，票据走 query 才能直接进 <img> / <a> */
  function fileUrl(rel: string) {
    return fileDownloadUrl(rel, mediaTicket.value)
  }

  /* ---------------- 新建 ---------------- */

  function openCreate(type: 'dir' | 'file') {
    createType.value = type
    createName.value = ''
    createOpen.value = true
  }

  async function submitCreate() {
    const name = createName.value.trim()
    if (!name) {
      message.warning('输入名称')
      return
    }
    try {
      if (createType.value === 'dir') await apiFileMkdir(joinPath(name))
      else await apiFileCreate({ path: joinPath(name) })
      createOpen.value = false
      message.success(createType.value === 'dir' ? '已创建文件夹' : '已创建文件')
      load()
    } catch {
      // 错误已由请求层弹出
    }
  }

  /* ---------------- 重命名 ---------------- */

  function openRename(f: FsFile) {
    renamePath.value = joinPath(f.name)
    renameName.value = f.name
    renameOpen.value = true
  }

  async function submitRename() {
    const name = renameName.value.trim()
    if (!name) {
      message.warning('输入新名称')
      return
    }
    try {
      await apiFileRename({ path: renamePath.value, newName: name })
      renameOpen.value = false
      message.success('已重命名')
      load()
    } catch {
      // 错误已由请求层弹出
    }
  }

  /* ---------------- 删除 ---------------- */

  function confirmDelete(f: FsFile) {
    Modal.confirm({
      title: f.isDir ? `删除文件夹「${f.name}」？` : `删除文件「${f.name}」？`,
      content: f.isDir ? '文件夹里的内容会一起删掉，且不可恢复。' : '删除后不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await apiFileDelete(joinPath(f.name))
          message.success('已删除')
          load()
        } catch {
          // 错误已由请求层弹出
        }
      },
    })
  }

  /**
   * 批量删除。
   *
   * 后端是逐项删的，允许部分失败，所以这里按结果分别提示 ——
   * 不能笼统说「删除成功」，否则某项被占用没删掉会没人发现。
   */
  function confirmBatchDelete() {
    const names = [...selectedNames.value]
    if (!names.length) return
    const dirCount = list.value.filter((f) => selected.value.has(f.name) && f.isDir).length
    Modal.confirm({
      title: `删除选中的 ${names.length} 项？`,
      content: dirCount
        ? `其中 ${dirCount} 个文件夹，里面的内容会一起删掉，且不可恢复。`
        : '删除后不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          const res = await apiFileDeleteBatch(names.map((n) => joinPath(n)))
          if (res.failed.length) {
            message.warning(
              `已删除 ${res.deleted.length} 项，${res.failed.length} 项没删成：${res.failed[0].message}`,
            )
          } else {
            message.success(`已删除 ${res.deleted.length} 项`)
          }
          exitSelectMode()
          load()
        } catch {
          // 错误已由请求层弹出
        }
      },
    })
  }

  /* ---------------- 上传 ---------------- */

  function onUploadChange(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length) void uploadFiles(files)
  }

  async function uploadFiles(files: File[]) {
    uploading.value = true
    try {
      const fd = new FormData()
      fd.set('path', currentPath.value)
      for (const f of files) fd.append('files', f)
      const data = await apiFileUpload(fd)
      message.success(`已上传 ${data.saved.length} 个文件`)
      load()
    } catch {
      // 错误已由请求层弹出
    } finally {
      uploading.value = false
    }
  }

  function onDirChange(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length) void uploadDirFiles(files)
  }

  /**
   * 上传整个文件夹。
   *
   * 浏览器会给出每个文件的 `webkitRelativePath`（如 `我的夹/sub/a.txt`），
   * 它按下标跟 files 一一对应，后端照这个相对路径建子目录。
   * 一次几百个文件塞进一个请求容易超时，所以按 50 个一批发。
   */
  async function uploadDirFiles(files: File[]) {
    const BATCH = 50
    const total = files.length
    const tipKey = 'guoba-upload-dir'
    let done = 0
    let failed = ''
    uploading.value = true
    uploadHint.value = `0/${total}`
    try {
      for (let i = 0; i < total; i += BATCH) {
        const batch = files.slice(i, i + BATCH)
        const relPaths = batch.map((f) => {
          const rel = (f as File & {webkitRelativePath?: string}).webkitRelativePath
          return rel || f.name
        })
        const fd = new FormData()
        fd.set('path', currentPath.value)
        fd.set('relPaths', JSON.stringify(relPaths))
        for (const f of batch) fd.append('files', f)
        const data = await apiFileUpload(fd)
        done += data.saved.length
        uploadHint.value = `${done}/${total}`
        message.loading({content: `正在上传文件夹 ${done}/${total}…`, key: tipKey, duration: 0})
      }
      message.success({content: `已上传 ${done} 个文件`, key: tipKey})
      load()
    } catch (e) {
      failed = (e as Error)?.message ?? ''
      // 中途失败时前面的批次已经落盘了，刷新让主人看到实际结果
      message.error({content: failed ? `上传中断：${failed}` : '上传中断', key: tipKey})
      load()
    } finally {
      uploading.value = false
      uploadHint.value = ''
    }
  }

  function downloadUrl(f: FsFile) {
    return f.isDir
      ? fileDownloadDirUrl(joinPath(f.name), mediaTicket.value)
      : fileDownloadUrl(joinPath(f.name), mediaTicket.value)
  }

  /** 当前目录整个打包下载（根目录也能下，包名会是 Yunzai.zip） */
  const currentZipUrl = computed(() => fileDownloadDirUrl(currentPath.value, mediaTicket.value))

  /** 用一个临时 <a> 触发下载：确认之后才走，不能事先写死在 href 上 */
  function triggerDownload(url: string) {
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  /**
   * 下载当前整个目录。这个按钮离「刷新」很近，在根目录上点下去就是十几 G，
   * 所以先问一句。指向某个目录的下载是用户自己点的，不用再确认。
   */
  function downloadCurrent() {
    Modal.confirm({
      title: `打包下载「${currentPath.value || 'Yunzai 根目录'}」？`,
      content: '把目录打成 zip 边打边传，大目录要传很久，可随时取消。',
      okText: '开始下载',
      cancelText: '取消',
      onOk() {
        triggerDownload(currentZipUrl.value)
      },
    })
  }

  /* ---------------- 文件夹大小 ---------------- */

  /** 算一个文件夹：结果按相对路径缓存，重复点不重复算 */
  async function calcSize(f: FsFile) {
    const rel = joinPath(f.name)
    if (dirSizes.value[rel]?.loading) return
    dirSizes.value[rel] = { loading: true }
    try {
      const d = await apiFileDirSize(rel)
      dirSizes.value[rel] = { loading: false, ...d }
    } catch {
      // 错误已由请求层弹出，清掉 loading 让用户能重试
      delete dirSizes.value[rel]
    }
  }

  /** 算当前目录下所有文件夹。同时开 3 个，一个个出结果，不用等全部算完 */
  async function calcAllSizes() {
    if (calcAllRunning.value) return
    const queue = list.value.filter((f) => f.isDir && !dirSizes.value[joinPath(f.name)])
    if (!queue.length) return
    calcAllRunning.value = true
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          for (let f = queue.shift(); f; f = queue.shift()) await calcSize(f)
        }),
      )
    } finally {
      calcAllRunning.value = false
    }
  }

  /** 大小列的文字：撞上后端上限时标「≥」，别让不完整的数字冒充准数 */
  function dirSizeText(f: FsFile) {
    const d = dirSizes.value[joinPath(f.name)]
    if (!d || d.loading || d.size === undefined) return ''
    return `${d.partial ? '≥ ' : ''}${fmtSize(d.size)}`
  }

  function dirSizeTitle(f: FsFile) {
    const d = dirSizes.value[joinPath(f.name)]
    if (!d || d.loading || d.size === undefined) return '算这个文件夹占多大'
    const base = `${d.files} 个文件、${d.dirs} 个子文件夹`
    return d.partial ? `${base}（目录太大只数了一部分，实际更多）` : base
  }

  onMounted(async () => {
    await refreshTicket()
    await load()
    // 票据 5 分钟过期，停留久了要换一张
    ticketTimer = window.setInterval(refreshTicket, TICKET_REFRESH_MS)
  })

  onBeforeUnmount(() => {
    if (ticketTimer) window.clearInterval(ticketTimer)
    ticketTimer = undefined
  })

  return {
    vm: reactive({
      currentPath,
      list,
      loading,
      breadcrumbs,
      parentPath,
      selectedNames,
      allSelected,
      selectMode,
      isSelected,
      toggleSelect,
      toggleSelectAll,
      clearSelection,
      exitSelectMode,
      viewOpen,
      viewMode,
      viewPath,
      viewName,
      viewContent,
      editing,
      saving,
      savePreview,
      fileUrl,
      onOpen,
      onEdit,
      createOpen,
      createType,
      createName,
      openCreate,
      submitCreate,
      renameOpen,
      renameName,
      openRename,
      submitRename,
      confirmDelete,
      confirmBatchDelete,
      uploading,
      uploadHint,
      onUploadChange,
      onDirChange,
      downloadUrl,
      triggerDownload,
      downloadCurrent,
      dirSizes,
      calcAllRunning,
      calcSize,
      calcAllSizes,
      dirSizeText,
      dirSizeTitle,
      isEditable,
      fmtSize,
      fmtTime,
      joinPath,
      load,
      goBreadcrumb,
    }),
    uploadEl,
    uploadDirEl,
  }
}

export type FileManager = ReturnType<typeof useFileManager>['vm']
