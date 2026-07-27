# 应付宝 (YingFuBao) — 应付账款管理系统

面向中小企业的在线应付账款管理工具：登录后上传增值税发票（图片/PDF），系统自动 OCR 识别并录入发票列表，按 **15 / 30 / 60 / 90 天** 账期生成到期提醒，并管理供应商（销售方）。

## 功能特性

- 🔐 **用户登录**：注册 / 登录，JWT 鉴权，数据按用户隔离
- 📄 **发票 OCR 识别**：上传发票图片或 PDF，自动提取发票号码、开票日期、销售方名称/税号、金额、税额、税率等
  - 引擎优先级：腾讯云增值税发票 OCR（推荐） → 本地 Tesseract → 人工补录（始终可用）
- 📊 **发票列表**：筛选、搜索、编辑、标记已付款、删除
- ⏰ **到期提醒**：按 15/30/60/90 天及已逾期分组统计，仪表盘总览
- 🏢 **供应商管理**：自动建档、按发票归集、统计交易金额
- 🖥️ **前后端一体**：FastAPI 同时提供 API 与托管构建后的前端

## 技术栈

- 后端：FastAPI + SQLAlchemy + SQLite + python-jose(JWT) + bcrypt
- OCR：腾讯云 OCR（`tencentcloud-sdk-python`）/ pytesseract + pymupdf(PDF)
- 前端：React 18 + TypeScript + Vite + Ant Design 5

## 目录结构

```
yingfubao/
├── backend/                # FastAPI 后端
│   ├── main.py             # 应用入口与全部 API
│   ├── auth.py             # JWT 鉴权与密码哈希
│   ├── models.py           # 数据库模型
│   ├── database.py         # SQLAlchemy 引擎/会话
│   ├── ocr_service.py      # OCR 识别（可插拔引擎）
│   ├── requirements.txt
│   └── uploads/            # 上传的发票文件
├── frontend/               # React 前端
│   ├── src/
│   └── dist/               # 构建产物（生产由后端托管）
├── Dockerfile              # 生产镜像（含 tesseract）
├── .env.example            # 环境变量示例
├── build.bat / start-dev.bat / start-prod.bat
└── README.md
```

---

## 一、本地运行

### 方式 A：生产模式（后端一体托管前端，最简单）

```bat
build.bat            :: 构建前端到 frontend/dist
start-prod.bat       :: 启动后端（自动建 venv、装依赖），访问 http://localhost:8000
```

> 首次运行 `start-prod.bat` 会自动创建 Python 虚拟环境并安装依赖（需联网）。

### 方式 B：开发模式（前后端热更新）

```bat
start-dev.bat        :: 同时启动后端 :8000 与前端 :3000
```

浏览器打开 http://127.0.0.1:3000

### 手动步骤（Linux / macOS）

```bash
# 后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 &

# 前端（新终端）
cd frontend
npm install
npm run build        # 构建后由后端 / 托管
# 或 npm run dev 开发模式（:3000，代理 /api 到 :8000）
```

---

## 二、OCR 配置（可选，但推荐）

系统在无 OCR 时仍可运行（上传后弹窗人工补录）。要开启自动识别：

### 方案 1：腾讯云 OCR（推荐，专为中文发票优化）

1. 注册腾讯云，在「访问管理 → API 密钥管理」获取 SecretId / SecretKey
2. 开通「文字识别」下的「增值税发票识别」服务（有免费额度）
3. 在 `backend/` 下创建 `.env`：

```ini
JWT_SECRET=你的随机密钥
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
```

4. 重启后端即可。识别精度最高，支持增值税专用发票/普通发票。

### 方案 2：本地 Tesseract（零密钥，可离线）

- 服务器安装 Tesseract 并包含中文包 `chi_sim`：
  - Ubuntu/Debian：`apt-get install tesseract-ocr tesseract-ocr-chi-sim`
  - Windows：安装 UB-Mannheim Tesseract 并勾选中文
- 未配置腾讯云密钥时自动启用；无需额外环境变量。

---

## 三、部署到服务器（Docker，推荐上线方式）

```bash
# 构建镜像
docker build -t yingfubao .

# 运行（映射端口，传入密钥）
docker run -d --name yingfubao \
  -p 8000:8000 \
  -e JWT_SECRET=随机长字符串 \
  -e TENCENT_SECRET_ID=你的SecretId \
  -e TENCENT_SECRET_KEY=你的SecretKey \
  yingfubao
```

访问 `http://服务器IP:8000`。

### 无 Docker 的云主机

在云主机（如腾讯云 CVM、阿里云 ECS）上：

```bash
git clone <repo> && cd yingfubao
# 后端
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt gunicorn
uvicorn main:app --host 0.0.0.0 --port 8000   # 或 gunicorn main:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
# 前端（另开终端）
cd ../frontend && npm install && npm run build
```

配合 Nginx 反向代理 + HTTPS 即可公网访问。示例 Nginx：

```nginx
server {
    listen 80; server_name your.domain.com;
    location / { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; }
}
```

### 云平台（Render / Railway / Fly.io）

这些平台支持直接部署 Docker 镜像或 Python 服务。构建命令 `pip install -r requirements.txt`，启动命令：
`gunicorn main:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:$PORT`，
需设置环境变量 `JWT_SECRET` 与腾讯云密钥（可选）。

---

## 四、数据说明

- 数据存储在 `backend/yingfubao.db`（SQLite），部署时请备份该文件。
- 上传的发票原图保存在 `backend/uploads/`。
- 付款截止日默认 = 开票日期 + 90 天；手动新增可自定义或留空自动推算。
- 税率：金晟达/星辰瑞杰/湖北道正为 13%，新瑞雨辰为 3%（加工服务），系统按识别结果分别入账。

## 五、常见问题

| 现象 | 排查 |
|---|---|
| 上传后发票字段为空 | 未配置 OCR 引擎，属正常——在弹窗人工补全即可 |
| 登录提示密码错误 | 确认注册成功；SQLite 库在 `backend/yingfubao.db` |
| 前端刷新子页面 404 | 已由后端 SPA 回退处理；若用纯静态托管需配置 history fallback |
| OCR 识别不准 | 推荐使用腾讯云 OCR；或检查发票图片清晰度 |
