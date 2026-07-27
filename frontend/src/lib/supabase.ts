// Supabase 客户端初始化
// 百度 API Key / Secret Key 仅存储在 Supabase Edge Function 服务端 Secrets 中，前端不可见。
// 以下 publishable / anon key 由 Supabase 设计为可安全公开嵌入前端代码。
//
// 配置来源：构建时由 deploy.yml 注入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（取自仓库 Secrets）。
// 若未注入（如本地开发未设 .env，或 Secrets 暂未配置），回退到下方硬编码默认值，保证始终可用。
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://thtwtqrlrgmiitwjrhep.supabase.co';

const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_Pha3CoAGVuV80f5gszp0Yg_yt4Y4qpV';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
