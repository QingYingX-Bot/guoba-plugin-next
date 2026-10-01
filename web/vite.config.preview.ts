import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

/**
 * 「喵喵帮助」布局预览构建配置。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./preview', import.meta.url)),
  base: './',
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@\/api$/, replacement: fileURLToPath(new URL('./preview/stub-api.ts', import.meta.url)) },
      { find: /^@\/stores\/auth$/, replacement: fileURLToPath(new URL('./preview/stub-auth.ts', import.meta.url)) },
      { find: /^@\//, replacement: `${srcDir}/` },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('../../../temp/miao-preview', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
