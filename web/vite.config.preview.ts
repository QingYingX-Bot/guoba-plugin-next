import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 面板页面的独立预览壳（没有登录态时用来看排版、量尺寸）。
 *
 *   node node_modules/vite/bin/vite.js build -c vite.config.preview.ts
 *
 * 两个入口：
 *   index.html   喵喵帮助（?mode 之类不读，直接渲染）
 *   theme.html   外观设置（?mode=dark 可切深色）
 *
 * 只把数据层换掉（@/api、@/stores/auth），页面组件、store、主题 token、样式全是真的。
 */
const srcDir = fileURLToPath(new URL('./src', import.meta.url))
const previewDir = fileURLToPath(new URL('./preview', import.meta.url))

export default defineConfig({
  root: previewDir,
  base: './',
  // 面板里的 /logo.png 是绝对路径，靠它落到产物根目录
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@\/api$/, replacement: path.join(previewDir, 'stub-api.ts') },
      { find: /^@\/stores\/auth$/, replacement: path.join(previewDir, 'stub-auth.ts') },
      { find: /^@\//, replacement: srcDir + '/' },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('../../../temp/guoba-preview', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: path.join(previewDir, 'index.html'),
        theme: path.join(previewDir, 'theme.html'),
      },
    },
  },
})
