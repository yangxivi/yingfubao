# ---- 阶段1：构建前端 ----
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- 阶段2：运行后端（同时托管前端）----
FROM python:3.11-slim
WORKDIR /app

# 系统依赖（pymupdf 需要，tencentcloud-sdk 纯 python）
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

WORKDIR /app/backend
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000", "--workers", "2"]
