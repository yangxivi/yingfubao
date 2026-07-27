# 应付宝 — 百度 OCR（高精度）接入与部署指南

## 一、架构概览

| 环节 | 技术 | 说明 |
|------|------|------|
| 前端上传 | React + Vite | 图片/PDF → 压缩/base64 → 调 Supabase 函数 |
| 中转层 | **Supabase Edge Function**（`baidu-ocr`） | Deno 运行时，保管百度密钥，调百度 API |
| OCR 引擎 | **百度 高精度通用文字识别（`accurate_basic`）** | 服务端调用，识别率高 |
| 字段提取 | 前端 `ocr.ts` 正则+锚点 | 复用原有逻辑，不动 |
| 存储 | 浏览器 localStorage | 发票/供应商数据，按账号隔离 |

> ⚠️ 关键点：**百度 API Key / Secret Key 只在 Supabase Edge Function 的环境变量里**，绝不下发到浏览器。浏览器只持有 Supabase 的 anon key（可公开）。

调用链路：
```
前端选择发票 → 压缩为 base64 → POST Supabase Edge Function(baidu-ocr)
   → 函数用 BAIDU_API_KEY/SECRET 换 token → 调百度 accurate_basic
   → 返回 raw_text → 前端 parseStructured() 提取字段 → 落库 + 自动建档供应商
```

---

## 二、申请百度 OCR 密钥

1. 登录 [百度智能云控制台](https://console.bce.baidu.com/)
2. 进入 **产品服务 → 人工智能 → 文字识别**
3. 开通 **「通用文字识别（高精度版）** 服务（新用户有免费调用额度）
4. 进入 **应用列表 → 创建应用**（任意填写，无需特殊配置）
5. 创建后在应用详情拿到两个值：
   - **API Key**
   - **Secret Key**

> `accurate_basic` 接口即对应「通用文字识别（高精度版）」，按文档价有免费额度，超量后按量计费。

---

## 三、创建 Supabase 项目并部署函数

### 1. 创建项目
- 注册 [supabase.com](https://supabase.com) → **New Project**
- 建好后进入 **Project Settings → API**，记下：
  - **Project URL**（形如 `https://<ref>.supabase.co`）
  - **anon public key**

### 2. 安装并登录 CLI
```bash
npm install -g supabase
supabase login
```

### 3. 部署 Edge Function
项目里已写好 `supabase/functions/baidu-ocr/index.ts`，直接部署：
```bash
# 在项目根目录（含 supabase/ 文件夹）执行
supabase functions deploy baidu-ocr --project-ref <你的 project-ref>
```

### 4. 配置百度密钥（Secrets）
```bash
supabase secrets set \
  BAIDU_API_KEY=你的APIKey \
  BAIDU_SECRET_KEY=你的SecretKey \
  --project-ref <你的 project-ref>
```
设置后函数才能换取百度 token。可在 Dashboard → Edge Functions → Secrets 里查看/修改。

> 可选：默认 anon 即可调用该函数。若要限制只有登录用户能调，可在函数里校验 `req.headers` 的 Authorization JWT（当前版本放行，便于 MVP 快速跑通）。

---

## 四、前端配置

1. 复制模板并填写：
   ```bash
   cp frontend/.env.example frontend/.env
   ```
2. 编辑 `frontend/.env`：
   | 变量 | 值 | 说明 |
   |------|-----|------|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | 来自第三步 |
   | `VITE_SUPABASE_ANON_KEY` | anon key | 来自第三步，可公开 |
   | `VITE_BASE_URL` | `/yingfubao/` | 部署到 GitHub Pages 项目站点时填；本地开发留 `/` 或空 |

3. 本地开发：
   ```bash
   cd frontend && npm install && npm run dev
   ```
4. 生产构建：
   ```bash
   npm run build      # 输出到 frontend/dist/
   ```

---

## 五、部署上线（GitHub Pages）

沿用现有流程：**push 到 `main` 分支 → GitHub Pages 自动部署**。

```bash
git add -A
git commit -m "feat: 接入百度高精度 OCR（Supabase Edge Function 中转）"
git push origin main
```
推送后访问 `https://yangxivi.github.io/yingfubao/` 验证。

> 注意：`.env` 已被 `.gitignore` 忽略，**不会**提交到仓库，密钥安全。

---

## 六、本地端到端联调（可选）

若想在本地跑 Supabase（含函数），需 Docker：
```bash
supabase start                              # 启动本地 supabase（含函数运行环境）
supabase functions deploy baidu-ocr         # 部署到本地
```
前端 `.env` 改用本地地址：`VITE_SUPABASE_URL=http://127.0.0.1:54321`、`VITE_SUPABASE_ANON_KEY=本地 anon key`（见 `supabase status`）。

---

## 七、常见问题

| 现象 | 排查 |
|------|------|
| 前端提示「未配置 Supabase」 | 检查 `frontend/.env` 是否填了 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，且文件名是 `.env`（不是 `.env.example`） |
| 百度报错 `110` / 认证失败 | API Key/Secret Key 填错，或服务未开通；去百度控制台核对 |
| 百度报错 `SDK 未开通` | 该 API 未在控制台开通「通用文字识别（高精度版）」 |
| 上传后识别为空 | 看浏览器控制台函数返回；可能是图片过大（前端已压缩到 2000px/0.85，个别超长发票可再调小 `imageToCompressedBase64` 的 `maxSide`） |
| CORS 报错 | Edge Function 已内置 CORS 响应头，无需额外配置；确认函数已成功部署 |
| 调用很慢/偶发失败 | 百度接口偶有限流，可加重试；或检查网络 |
