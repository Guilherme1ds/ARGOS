import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O proxy deixa web e API no mesmo site (cookie SameSite=Lax). VITE_PROXY_TARGET muda o destino (ex.: API descartável do E2E).
const apiTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3333'
const proxy = {
  '/api': { target: apiTarget, changeOrigin: true },
  '/uploads': { target: apiTarget, changeOrigin: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    proxy,
  },
})
