import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref('preview-token')
  const liteToken = ref('preview-lite')

  async function refreshLiteToken() {
  }

  return { token, liteToken, refreshLiteToken }
})
