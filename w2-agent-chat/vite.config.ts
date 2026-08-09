import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 客户端 dev server 把 /api 代理到 Express 后端（3001）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
