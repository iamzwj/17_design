import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep the preceding hashed assets during a deployment. A browser that
    // received the prior HTML can then still load its CSS/JS while the next
    // build is being written, instead of falling back to an unstyled page.
    emptyOutDir: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
