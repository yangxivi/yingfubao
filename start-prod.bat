@echo off
chcp 65001 >nul
echo ========================================
echo   应付宝 - 生产模式启动（后端+前端一体）
echo ========================================
set "YB_DIR=%~dp0"
cd /d "%YB_DIR%backend"

REM 自动安装依赖（首次）
if not exist "venv\Scripts\python.exe" (
    echo 首次运行，创建虚拟环境并安装依赖...
    python -m venv venv
    call venv\Scripts\pip install -r requirements.txt
)

echo 启动服务: http://0.0.0.0:8000
call venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
