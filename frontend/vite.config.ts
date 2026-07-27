import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 项目站点基路径：https://<user>.github.io/<repo>/
  // 本地构建 / 开发不设置该变量时，默认使用根路径 '/'
  base: process.env.VITE_BASE_URL || '/',
  // Supabase 配置：构建时注入（优先读环境变量，否则用硬编码兜底）。
  // publishable/annon key 设计为可公开嵌入前端，百度密钥仅在 Edge Function 服务端。
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      process.env.VITE_SUPABASE_URL || 'https://thtwtqrlrgmiitwjrhep.supabase.co',
    ),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Pha3CoAGVuV80f5gszp0Yg_yt4Y4qpV',
    ),
  },
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
