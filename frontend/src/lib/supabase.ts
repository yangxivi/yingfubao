// Supabase 客户端初始化
// 百度 API Key / Secret Key 仅存储在 Supabase Edge Function 服务端 Secrets 中，前端不可见。
// 以下 publishable / annon key 由 Supabase 设计为可安全公开嵌入前端代码。
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://thtwtqrlrgmiitwjrhep.supabase.co',
  'sb_publishable_Pha3CoAGVuV80f5gszp0Yg_yt4Y4qpV',
);
