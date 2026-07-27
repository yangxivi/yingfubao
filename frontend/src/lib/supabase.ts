// Supabase 客户端初始化（前端安全暴露 anon key；百度密钥只在 Edge Function 服务端）
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // 不打断页面，只是百度 OCR 不可用；本地开发需复制 .env.example 为 .env
  console.warn(
    '⚠️ 未配置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，百度 OCR 将不可用。' +
      '请复制 frontend/.env.example 为 frontend/.env 并填写。',
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
