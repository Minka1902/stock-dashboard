import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // With the same-origin default BASE (""), proxy API calls from the :5173 dev
  // server to the backend on :8000 so the hot-reload flow still works. In the
  // single-port build the backend serves dist/ and no proxy is involved.
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
})
