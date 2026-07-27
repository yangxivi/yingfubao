// Supabase Edge Function —— 百度 OCR 高精度通用文字识别（accurate_basic）中转
// 作用：前端把发票图片 base64 发到这里，函数用服务端保管的百度密钥换取 token 并调用 OCR，
//       再把识别出的文字返回前端，避免把百度 API Key/Secret 暴露给浏览器。
//
// 部署：supabase functions deploy baidu-ocr
// 环境变量（Supabase Dashboard → Project Settings → Edge Functions → Secrets）：
//   BAIDU_API_KEY    百度智能云「文字识别」应用的 API Key
//   BAIDU_SECRET_KEY 百度智能云「文字识别」应用的 Secret Key

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const BAIDU_OCR_URL =
  "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic";

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

Deno.serve(async (req: Request) => {
  // 预检请求
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (req.method !== "POST") {
      throw new Error("仅支持 POST 方法");
    }
    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      throw new Error("缺少 image 字段（纯 base64 字符串，不含 data: 前缀）");
    }
    const token = await getBaiduToken();
    const body = new URLSearchParams();
    body.set("image", image);
    const resp = await fetch(`${BAIDU_OCR_URL}?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await resp.json();
    if (data.error_code) {
      throw new Error(
        `百度 OCR 错误 ${data.error_code}: ${data.error_msg ?? ""}`,
      );
    }
    const raw_text = (data.words_result ?? [])
      .map((w: { words: string }) => w.words)
      .join("\n");
    return new Response(
      JSON.stringify({
        raw_text,
        words_result: data.words_result ?? [],
        words_result_num: data.words_result_num ?? 0,
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
