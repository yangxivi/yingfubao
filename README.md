# 应付宝 (YingFuBao) — 应付账款管理系统

面向中小企业的在线应付账款管理工具：上传增值税发票（图片/PDF），系统自动 **OCR 识别**并录入发票列表，按账期生成到期提醒，统一管理供应商信息。支持 **云端多浏览器同步** 与 **数据驾驶舱可视化**。

> 🌐 **在线体验**：[https://yangxivi.github.io/yingfubao/](https://yangxivi.github.io/yingfubao/)

## 功能特性

### 📊 数据驾驶舱
- **6 张可视化图表**（零依赖，纯 SVG + Ant Design 实现）：
  - 近 12 月付款趋势（面积折线图，hover 显示参考线与金额）
  - 付款状态分布（环形图，扇区高亮切换圆心数据）
  - 应付账龄分布（柱状图，hover 柱顶金额）
  - Top5 供应商应付款（横向条形图，完整显示公司名称）
  - 待付款到期分布（红色面积图，按逾期/30/60/90/120/150/180 天分桶）
  - 本月付款完成率（进度环 + 已付/应付明细）
- 统计卡片：发票总数、金额合计、待付款 / 已逾期
- 到期发票提醒（**7 档位**：已逾期 / 30 / 60 / 90 / 120 / 150 / 180 天内，Tab 切换）
- 最近 5 条发票 & 最近 5 家供应商快捷入口

### 📄 发票管理
- **OCR 智能识别**：上传图片或 PDF，自动提取发票号码、开票日期、销售方名称/税号、金额、税额、税率等字段
- **批量上传进度**：多张发票串行处理，实时显示「第 X 张 / 共 N 张」+ 完成提示
- **多维度筛选**：关键词搜索 + 状态筛选 + 高级筛选（供应商 / 开票日期范围 / 付款日期范围 / 金额区间）
- **表格操作**：列排序、分页、多选批量删除（带确认弹窗）
- **编辑联动**：修改开票日期时，付款日期自动 + 账期天数（可手动覆盖）
- **全局账期**：支持自定义账期天数（默认 90 天），提供 30/60/90/120/180 天快速选择按钮；修改后自动重算所有未付款发票的付款日期与剩余/逾期天数
- **状态流转**：待付款 → 已付款 / 已逾期；逾期发票显示「逾期 X 天」而非「剩余 X 天」
- **详情抽屉**：查看完整字段 + 发票原图预览 + 上传/更换发票图

### 🏢 供应商管理
- 自动建档（OCR 识别出的供应商自动入库去重）
- 完整档案：公司名称、统一社会信用代码、联系人、电话、地址、开户银行、银行账号、备注
- 多选批量删除、列排序、搜索筛选
- 有/无联系人快捷筛选

### ☁️ 云端同步
- 基于 **Supabase**（PostgreSQL）存储，**同一账号跨浏览器/设备数据一致**
- **双模式运行**：
  - **云端模式**（推荐）：数据存 Supabase，任意浏览器登录即可访问
  - **本地降级模式**：Supabase 未初始化时自动降级到 localStorage（单浏览器可用），登录页显示引导横幅
- **一键建表向导**：顶栏点击「本地模式」标识 → 3 步向导复制 SQL → Supabase SQL Editor 执行 → 验证完成自动切云端
- 首次使用需在 Supabase 执行 `supabase/schema.sql` 建表并关闭 RLS（详见下方部署说明）

### ⚙️ 设置
- 全局账期天数设置（自定义输入 + 快速选择按钮）
- 修改后一键重新计算所有未付款发票的付款日期

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 + TypeScript (strict) |
| UI 组件库 | Ant Design 5 + @ant-design/icons |
| 构建工具 | Vite 6 |
| 路由 | React Router v6 |
| 图表 | 内联 SVG（零依赖，6 张交互式图表） |
| 日期处理 | dayjs |
| PDF 渲染 | pdfjs-dist |
| 数据库 / 后端 | **Supabase** (PostgreSQL + REST API) |
| OCR 引擎 | **百度 AI 高精度文字识别** (accurate_basic)，通过 Supabase Edge Function 中转 |
| 部署 | GitHub Actions → **GitHub Pages** (SPA + 404 fallback) |

## 项目结构

```
yingfubao/
├── frontend/                        # React 前端（主应用）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx        # 登录页（双模式引导横幅）
│   │   │   ├── DashboardPage.tsx    # 仪表盘 + 6 张驾驶舱图表
│   │   │   ├── InvoiceListPage.tsx  # 发票列表（筛选/多选/批量删除/编辑）
│   │   │   ├── SupplierListPage.tsx # 供应商管理
│   │   │   ├── UploadPage.tsx       # 发票上传（批量进度提示）
│   │   │   ├── RemindersPage.tsx    # 到期提醒（7 档位）
│   │   │   └── SettingsPage.tsx     # 全局账期设置
│   │   ├── components/
│   │   │   ├── Layout.tsx           # 主布局（导航栏 + 同步状态标识 + 建表向导）
│   │   │   └── SetupWizard.tsx      # 一键建表向导（3 步）
│   │   ├── api/client.ts            # 业务 API 封装
│   │   ├── lib/
│   │   │   ├── supabase.ts          # Supabase 客户端初始化
│   │   │   ├── supabase-init.ts     # 云端表探测模块
│   │   │   ├── auth.ts              # 双模式鉴权（云端/本地降级）
│   │   │   ├── db.ts                # 双模式数据层（云端镜像缓存 + localStorage 降级）
│   │   │   ├── accountPeriod.ts     # 全局账期管理
│   │   │   ├── cloudStatus.ts       # 共享云端状态模块
│   │   │   └── ocr.ts               # OCR 调用 + 结构化字段提取
│   │   ├── App.tsx                  # 路由 + 启动探测
│   │   └── main.tsx                 # 入口
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── supabase/
│   ├── schema.sql                   # 建表 DDL（users/suppliers/invoices + 索引）
│   ├── migration_account_period.sql # 账期功能迁移 SQL
│   └── functions/
│       └── baidu-ocr/               # Edge Function（百度 OCR 中转）
├── .github/workflows/deploy.yml     # CI/CD：构建 → GitHub Pages
├── backend/                         # FastAPI 后端（本地开发备用）
├── docs/setup-baidu-ocr.md          # 百度 OCR 配置文档
└── README.md
```

## 快速开始

### 方式一：直接使用线上版本

打开 [https://yangxivi.github.io/yingfubao/](https://yangxivi.github.io/yingfubao/) 即可使用（无需安装）。

> ⚠️ 首次使用前需在 Supabase 执行建表 SQL（见下方「Supabase 初始化」），否则应用会以本地降级模式运行。

### 方式二：本地开发

```bash
# 克隆仓库
git clone https://github.com/yangxivi/yingfubao.git
cd yingfubao/frontend

# 安装依赖
npm install

# 复制环境变量（Supabase 配置）
cp .env.example .env
# 编辑 .env 填入你的 Supabase URL 和 Anon Key

# 启动开发服务器
npm run dev
```

浏览器打开 http://localhost:3000

### 方式三：本地后端模式（FastAPI）

如需使用本地 FastAPI 后端：

```bat
build.bat            # 构建前端到 frontend/dist
start-prod.bat       # 启动后端（自动创建 venv 并安装依赖）
```

访问 http://localhost:8000

## Supabase 初始化（首次使用必做）

应用依赖 Supabase 存储三张核心表。首次部署或新项目需要执行以下步骤：

### 1. 创建 Supabase 项目

注册 [Supabase](https://supabase.com/) 并创建项目，获取 **URL** 和 **anon key**。

### 2. 执行建表 SQL

在 Supabase Dashboard → **SQL Editor** 中执行 `supabase/schema.sql`，创建 `users` / `suppliers` / `invoices` 三张表及索引。

### 3. 关闭 RLS（重要）

Schema 设计为**应用层按 user_id 隔离**，无需 RLS。新建表默认开启 RLS 会阻止匿名写入，必须手动关闭：

```sql
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices DISABLE ROW LEVEL SECURITY;
```

### 4. 验证

打开应用，顶栏应显示 **☁️ 云端同步** 标识。若显示 **💾 本地模式**，点击该标识进入建表向导，按指引完成初始化。

## OCR 配置

系统默认使用 **百度高精度通用文字识别**（通过 Supabase Edge Function 中转），识别精度高且专为中文优化。

### 配置步骤

1. 注册 [百度智能云](https://cloud.baidu.com/)，开通「文字识别」服务
2. 在「应用管理」获取 **API Key** 和 **Secret Key**
3. 部署 Edge Function 并设置 Secrets（详见 [docs/setup-baidu-ocr.md](docs/setup-baidu-ocr.md)）

### 调用链路

```
前端上传发票图片
    ↓ base64 编码 + 压缩
Supabase Edge Function (baidu-ocr)
    ↓ 用 BAIDU_API_KEY / SECRET_KEY 换取 access_token
百度 OCR API (accurate_basic)
    ↓ 返回原始识别文本
前端正则 + 关键词锚定 → 结构化字段提取
    ↓ 自动填入发票列表 + 供应商自动建档
```

## 部署

### GitHub Pages（推荐）

项目已配置 GitHub Actions CI/CD，推送到 `main` 分支即自动部署：

1. Fork 本仓库
2. 在仓库 Settings → Secrets and variables → Actions 中添加：
   - `VITE_SUPABASE_URL` — 你的 Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` — 你的 Supabase anon public key
3. 在 Settings → Pages 中启用 GitHub Pages，选择 `gh-pages` 分支
4. 推送代码即可自动构建发布

### Docker

```bash
docker build -t yingfubao .
docker run -d --name yingfubao -p 8000:8000 yingfubao
```

## 数据说明

| 说明 | 详情 |
|------|------|
| 数据存储 | Supabase PostgreSQL（云端）/ localStorage（本地降级模式） |
| 发票图片 | base64 文本内联存储（个人小规模足够，后续可迁移 Storage） |
| 付款截止日 | 默认 = 开票日期 + **全局账期天数**（默认 90 天，可在设置页自定义） |
| 供应商建档 | OCR 识别出销售方名称后自动创建（去重），联系人/电话/地址供手动补充 |
| 跨浏览器同步 | 云端模式下同一账号在任意浏览器登录均可访问全部数据 |

## 常见问题

| 现象 | 排查 |
|------|------|
| 新浏览器登录报「用户名或密码错误」 | Supabase 表未创建或 RLS 未关闭 → 执行 schema.sql + DISABLE RLS SQL |
| 登录页显示橙色「本地模式」横幅 | 正常现象——云端未初始化，当前为单浏览器模式。按指引完成建表即可启用云端同步 |
| 注册报 "row-level security policy" | RLS 未关闭 → 在 SQL Editor 执行 3 条 ALTER TABLE ... DISABLE ROW LEVEL SECURITY |
| 页面显示「未配置 Supabase」 | 检查 `.env` 或 GitHub Secrets 是否正确填写了 Supabase URL 和 anon key |
| OCR 识别结果不准确 | 确保发票图片清晰、正放；复杂版式可在编辑弹窗手动修正 |
| 供应商税号配错 | 已修复——改用锚点行索引定位销售方/购买方区域，避免左右并排布局导致的误判 |
| GitHub Pages 刷新后还是旧版本 | 浏览器缓存导致，按 `Ctrl+Shift+R` 强制刷新 |

## License

MIT
