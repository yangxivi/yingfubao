# 应付宝后端 · 本地运行 + 内网穿透部署指南

> 适用场景：国外云平台（Render / Railway / Koyeb 等）在国内访问不稳定、打不开时，
> 用「本机运行后端 + 国内内网穿透」把后端暴露到公网，让 GitHub Pages 前端能连上。
> 零服务器、零绑卡、国内可访问、免费。

---

## 为什么不用国外平台

Render / Railway / Koyeb / Fly.io 等均为国外服务，国内网络环境下网页常打不开或部署后无法访问。
本项目 Dockerfile 已支持 `PORT` 注入、CORS=`*`、OCR 仅依赖本地 Tesseract（零密钥），
所以**最省事的方案是在你自己的 Windows 电脑上把后端跑起来，再用 cpolar 穿透出去**。

---

## 方案一：本机后端 + cpolar 穿透（★ 推荐，最省事）

### 步骤 1：在本机启动后端

项目根目录已有 `start-prod.bat`，双击即可（首次会自动建 venv 并装依赖，约 1–2 分钟）：

```
start-prod.bat
```

启动后访问 `http://127.0.0.1:8000/api/health` ，应返回：
```json
{"status":"ok","name":"应付宝"}
```

> 若想用 Docker（需先装 Docker Desktop），在项目根目录执行：
> ```bat
> docker build -t yingfubao .
> docker run -d -p 8000:8000 -e JWT_SECRET=你的随机长串 yingfubao
> ```

### 步骤 2：安装 cpolar（国内工具，可访问）

1. 打开 https://www.cpolar.com ，注册账号（国内站点，无需翻墙）。
2. 下载 Windows 版客户端并安装。
3. 拿到你的 authtoken，在命令行登录：
   ```bat
   cpolar authtoken 你的cpolar_token
   ```

### 步骤 3：穿透本地 8000 端口

```bat
cpolar http 8000
```

运行后会输出一个公网 https 地址，形如：
```
https://xxxx.cpolar.io      （或 xxxx.cpolar.cn）
```

这个地址就是后端公网入口。**保持此窗口不要关**，后端才能被外部访问。

### 步骤 4：让 GitHub Pages 前端连上后端

1. 打开 GitHub 仓库 `yangxivi/yingfubao` → **Settings → Secrets and variables → Actions → New repository secret**。
2. Name 填 `VITE_API_BASE_URL`，Value 填上一步的 cpolar 地址（如 `https://xxxx.cpolar.io`）。
3. 打开 **Actions → Deploy to GitHub Pages → Re-run all jobs**，等待完成。
4. 访问 **https://yangxivi.github.io/yingfubao/** ，即可注册、上传发票、使用全部功能。

### ⚠️ 注意事项

- **cpolar 免费版地址每次重启会变化**：后端或 cpolar 重启后，需重新执行步骤 3、4（更新 `VITE_API_BASE_URL` 并 Re-run Pages workflow）。
- 若要**固定地址**，需升级 cpolar 付费版；或改用「花生壳」等提供固定免费域名的工具（带宽较低）。
- 你的电脑需保持开机且 `start-prod.bat`、`cpolar` 两个窗口都运行，后端才在线。

---

## 方案二：国内云平台（无需本机常开）

若不想本机一直开着，可改用国内云（国内可访问、无需翻墙）：

### Sealos（sealos.run）
1. 注册登录 → 进入 **Sealos Cloud → 部署应用**。
2. 选择从 **GitHub 仓库** 部署（连 `yangxivi/yingfubao`，分支 `main`，自动检测 Dockerfile）。
3. 设置环境变量 `JWT_SECRET` = 长随机串。
4. 部署后拿到国内域名，回填 `VITE_API_BASE_URL` 并重跑 Pages workflow。

> 若 Sealos 要求「先有镜像」，可把镜像推到阿里云 ACR / Docker Hub 后再部署，需要我给命令时告诉我。

---

## 别忘了：启用 GitHub Pages（前端必须先可访问）

之前 Pages 的 `deploy` 曾失败，原因是仓库**未在网页启用 Pages**。若你还没做：

1. 打开 https://github.com/yangxivi/yingfubao/settings/pages
2. **Source** 选 **GitHub Actions** → 保存。
3. 到 **Actions** 里 **Re-run** 之前的 Pages 部署任务，前端即发布到 `https://yangxivi.github.io/yingfubao/`。

---

## 环境变量速查

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | 是 | 生产签名密钥，随机长串（如 `openssl rand -hex 32`） |
| `PORT` | 否 | 云平台/cpolar 场景由平台注入，本地默认 8000 |
| OCR 相关 | 否 | 当前已强化本地 Tesseract，零密钥、零配置 |

## 数据持久化提醒

后端用 SQLite（`backend/yingfubao.db`）。本机运行模式下数据保存在你电脑上，**重启电脑不会丢**；
若改用容器/云平台，磁盘多为临时，重启会重置（演示可接受）。
