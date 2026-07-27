import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 项目站点基路径：https://<user>.github.io/<repo>/
  // 本地构建 / 开发不设置该变量时，默认使用根路径 '/'
  base: process.env.VITE_BASE_URL || '/',
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
