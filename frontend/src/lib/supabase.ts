// Supabase 客户端初始化
// 百度 API Key / Secret Key 仅存储在 Supabase Edge Function 服务端 Secrets 中，前端不可见。
// 以下 publishable / anon key 由 Supabase 设计为可安全公开嵌入前端代码。
//
// 配置来源：构建时可由 .env 的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 注入（部署工作流不再注入 Secrets）。
// 若未注入，回退到下方硬编码默认值（指向当前生产项目 dpbtqwfbprartiogydqg），保证始终可用。
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://dpbtqwfbprartiogydqg.supabase.co';

const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_m6iKgdv8VRGdx1KXAzWpSQ_BCDocpl_';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
