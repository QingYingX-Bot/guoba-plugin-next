import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import { setupOfflineIcons } from '@/components/icons'
import MiaoPage from '@/views/miao/index.vue'
import '@/styles/index.css'

localStorage.setItem('guoba:theme', 'light')
document.documentElement.setAttribute('data-theme', 'light')
document.documentElement.style.colorScheme = 'light'

setupOfflineIcons()

const app = createApp(MiaoPage)
app.use(createPinia())
app.use(Antd)
app.mount('#app')

;(window as any).__PREVIEW_READY__ = true
