import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages 子路徑部署：https://<user>.github.io/ragdoll-coin-pusher/
export default defineConfig({
  base: '/ragdoll-coin-pusher/',
  plugins: [react()],
  build: {
    // three + rapier(wasm 內嵌) 體積較大，屬預期
    chunkSizeWarningLimit: 4000,
  },
})
