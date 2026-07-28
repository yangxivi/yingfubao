# 应付宝 (YingFuBao) — 应付账款管理系统

面向中小企业的在线应付账款管理工具：上传增值税发票（图片/PDF），系统自动 **OCR 识别**并录入发票列表，按账期生成到期提醒，统一管理供应商信息。

> 🌐 **在线体验**：[https://yangxivi.github.io/yingfubao/](https://yangxivi.github.io/yingfubao/)

## 功能特性

### 📊 仪表盘
- 发票总数、金额合计、待付款 / 已逾期统计卡片
- 到期发票提醒（按 15 / 30 / 60 / 90 天分组，支持 Tab 切换）
- 最近 5 条发票 & 最近 5 家供应商快捷入口

### 📄 发票管理
- **OCR 智能识别**：上传图片或 PDF，自动提取发票号码、开票日期、销售方名称/税号、金额、税额、税率等字段
- **多维度筛选**：关键词搜索 + 状态筛选 + 高级筛选（供应商 / 开票日期范围 / 付款日期范围 / 金额区间）
- **表格操作**：列排序、分页、多选批量删除（带确认弹窗）
- **编辑联动**：修改开票日期时，付款日期自动 +90 天（可手动覆盖）
- **状态流转**：待付款 → 已付款 / 已逾期，一键标记已付
- **详情抽屉**：查看完整字段 + 发票原图预览 + 上传/更换发票图

### 🏢 供应商管理
- 自动建档（OCR 识别出的供应商自动入库去重）
- 完整档案：公司名称、统一社会信用代码、联系人、电话、地址、开户银行、银行账号、备注
- 多选批量删除、列排序、搜索筛选
- 有/无联系人快捷筛选

### 🔐 数据安全
- 基于 **Supabase**（PostgreSQL）存储，数据云端持久化
- OCR 密钥通过 **Supabase Edge Function** 中转，前端不暴露
- 前端配置通过 **GitHub Secrets** CI 注入，代码中无硬编码密钥

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript (strict) |
| UI 组件库 | Ant Design 5 + @ant-design/icons |
| 构建工具 | Vite 6 |
| 路由 | React Router v6 |
| 日期处理 | dayjs |
| PDF 渲染 | pdfjs-dist |
| 数据库 / 后端 | **Supabase** (PostgreSQL + REST API + Row Level Security) |
| OCR 引擎 | **百度 AI 高精度文字识别** (accurate_basic)，通过 Supabase Edge Function 中转 |
| 部署 | GitHub Actions → **GitHub Pages** (SPA + 404 fallback) |

## 项目结构

```
yingfubao/
├── frontend/                        # React 前端（主应用）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx        # 登录页
│   │   │   ├── DashboardPage.tsx    # 仪表盘（统计+提醒+最近记录）
│   │   │   ├── InvoiceListPage.tsx  # 发票列表（筛选/多选/批量删除/编辑）
│   │   │   └── SupplierListPage.tsx # 供应商管理（多选/排序/批量删除）
│   │   ├── api/client.ts            # Supabase API 封装
│   │   ├── lib/
│   │   │   ├── supabase.ts          # Supabase 客户端初始化
│   │   │   └── ocr.ts               # OCR 调用 + 结构化字段提取
│   │   ├── components/              # 公共组件
│   │   ├── App.tsx                  # 路由与布局
│   │   └── main.tsx                 # 入口
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── supabase/
│   └── functions/
│       └── baidu-ocr/               # Edge Function（百度 OCR 中转）
│           └── index.ts
├── .github/workflows/deploy.yml     # CI/CD：构建 → GitHub Pages
├── backend/                         # FastAPI 后端（本地开发备用）
│   ├── main.py / models.py / auth.py
│   └── requirements.txt
├── docs/setup-baidu-ocr.md          # 百度 OCR 配置文档
└── README.md
```

## 快速开始

### 方式一：直接使用线上版本

打开 [https://yangxivi.github.io/yingfubao/](https://yangxivi.github.io/yingfubao/) 即可使用（无需安装）。

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

## OCR 配置

系统默认使用 **百度高精度通用文字识别**（通过 Supabase Edge Function 中转），识别精度高且专为中文优化。

### 配置步骤

1. 注册 [百度智能云](https://cloud.baidu.com/)，开通「文字识别」服务
2. 在「应用管理」获取 **API Key** 和 **Secret Key**
3. 创建 [Supabase](https://supabase.com/) 项目，获取 **URL** 和 **anon key**
4. 部署 Edge Function 并设置 Secrets（详见 [docs/setup-baidu-ocr.md](docs/setup-baidu-ocr.md)）

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
| 数据存储 | Supabase PostgreSQL（生产）/ SQLite `backend/yingfubao.db`（本地开发） |
| 发票图片 | 生产环境存 Supabase Storage；本地存 `backend/uploads/` |
| 付款截止日 | 默认 = 开票日期 + **90 天**；编辑时修改开票日期自动联动 |
| 供应商建档 | OCR 识别出销售方名称后自动创建（去重），联系人/电话/地址供手动补充 |

## 常见问题

| 现象 | 排查 |
|------|------|
| 页面显示「未配置 Supabase」 | 检查 `.env` 或 GitHub Secrets 是否正确填写了 Supabase URL 和 anon key |
| OCR 识别结果不准确 | 确保发票图片清晰、正放；复杂版式可在编辑弹窗手动修正 |
| 供应商税号配错 | 已修复——改用锚点行索引定位销售方/购买方区域，避免左右并排布局导致的误判 |
| GitHub Pages 刷新后还是旧版本 | 浏览器缓存导致，按 `Ctrl+Shift+R` 强制刷新 |

## License

MIT
