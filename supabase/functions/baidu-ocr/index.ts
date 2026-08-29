// Supabase Edge Function —— 百度 OCR 高精度通用文字识别（accurate_basic）中转 + 共享额度控制
// 作用：前端把发票图片 base64 发到这里，函数用服务端保管的百度密钥换取 token 并调用 OCR，
//       再把识别出的文字返回前端，避免把百度 API Key/Secret 暴露给浏览器。
//
// 部署：supabase functions deploy baidu-ocr
// 环境变量（Supabase Dashboard → Project Settings → Edge Functions → Secrets）：
//   BAIDU_API_KEY    百度智能云「文字识别」应用的 API Key
//   BAIDU_SECRET_KEY 百度智能云「文字识别」应用的 Secret Key
//
// 共享配额：
// - 每月默认 800 次免费共享调用（可在 supabase/migrations/20240828_add_shared_ocr_quota.sql 调整）。
// - 达到上限后返回 429，前端引导用户到「设置」配置自有百度 Key。

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const BAIDU_OCR_URL =
  "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic";

const MAX_SHARED_QUOTA = 800;

// 模块级缓存 access_token，减少换取次数（同一函数实例复用，约 30 天有效期）
let tokenCache: { token: string; expireAt: number } | null = null;

async function getBaiduToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expireAt > now + 60_000) {
    return tokenCache.token;
  }
  const apiKey = Deno.env.get("BAIDU_API_KEY");
  const secretKey = Deno.env.get("BAIDU_SECRET_KEY");
  if (!apiKey || !secretKey) {
    throw new Error("服务端未配置 BAIDU_API_KEY / BAIDU_SECRET_KEY");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey,
  });
  const resp = await fetch(BAIDU_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error("获取百度 access_token 失败: " + JSON.stringify(data));
  }
  tokenCache = {
    token: data.access_token,
    expireAt: now + (data.expires_in ?? 2592000) * 1000,
  };
  return data.access_token;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getQuota(supabase: any): Promise<{ used: number; total: number }> {
  const month = currentMonth();
  const { data, error } = await supabase
    .from("shared_ocr_quota")
    .select("used_count, max_count")
    .eq("month", month)
    .maybeSingle();
  if (error) {
    console.error("[ocr-quota] 查询失败:", error.message);
  }
  return {
    used: data?.used_count ?? 0,
    total: data?.max_count ?? MAX_SHARED_QUOTA,
  };
}

async function consumeQuota(supabase: any): Promise<{ used: number; total: number }> {
  const month = currentMonth();

  // 原子 +1（RPC 返回 TABLE，即数组；可能为空数组）
  const { data: rows, error: rpcError } = await supabase.rpc(
    "increment_shared_ocr_quota",
    { p_month: month, p_max: MAX_SHARED_QUOTA },
  );

  if (rpcError) {
    console.error("[ocr-quota] RPC 失败:", rpcError.message);
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row && typeof row.used_count === "number") {
    return { used: row.used_count, total: row.max_count ?? MAX_SHARED_QUOTA };
  }

  // RPC 不可用时的兜底：先查后插/更新（并发下可能少量超扣）
  const { data: existing } = await supabase
    .from("shared_ocr_quota")
    .select("used_count, max_count")
    .eq("month", month)
    .maybeSingle();

  if (!existing) {
    await supabase.from("shared_ocr_quota").insert({
      month,
      used_count: 1,
      max_count: MAX_SHARED_QUOTA,
    });
    return { used: 1, total: MAX_SHARED_QUOTA };
  }

  const next = existing.used_count + 1;
  await supabase
    .from("shared_ocr_quota")
    .update({ used_count: next, updated_at: new Date().toISOString() })
    .eq("month", month);
  return { used: next, total: existing.max_count ?? MAX_SHARED_QUOTA };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("仅支持 POST 方法");
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? (body.image ? "ocr" : "quota");

    // Supabase 客户端（service_role）
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("服务端未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (action === "quota") {
      const quota = await getQuota(supabase);
      return new Response(
        JSON.stringify({ quota }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action !== "ocr") {
      throw new Error("无效 action，仅支持 ocr / quota");
    }

    const image = body.image;
    if (!image || typeof image !== "string") {
      throw new Error("缺少 image 字段（纯 base64 字符串，不含 data: 前缀）");
    }

    // 检查共享额度
    const beforeQuota = await getQuota(supabase);
    if (beforeQuota.used >= beforeQuota.total) {
      return new Response(
        JSON.stringify({
          error: `共享 OCR 额度已用完（本月 ${beforeQuota.used}/${beforeQuota.total} 次）。请在「设置」中配置自己的百度 OCR Key 继续使用。`,
          quota: beforeQuota,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = await getBaiduToken();
    const form = new URLSearchParams();
    form.set("image", image);
    const resp = await fetch(`${BAIDU_OCR_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await resp.json();
    if (data.error_code) {
      throw new Error(`百度 OCR 错误 ${data.error_code}: ${data.error_msg ?? ""}`);
    }

    // 成功扣减额度
    const quota = await consumeQuota(supabase);

    const raw_text = (data.words_result ?? [])
      .map((w: { words: string }) => w.words)
      .join("\n");
    return new Response(
      JSON.stringify({
        raw_text,
        words_result: data.words_result ?? [],
        words_result_num: data.words_result_num ?? 0,
        quota,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message ?? "未知错误" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
