@echo off
chcp 65001 >nul
echo ========================================
echo   应付宝 - 开发模式启动（前后端分离）
echo ========================================
set "YB_DIR=%~dp0"

echo 启动后端 (http://127.0.0.1:8000) ...
start "yingfubao-backend" cmd /k "cd /d %YB_DIR%backend && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

echo 启动前端 (http://127.0.0.1:3000) ...
start "yingfubao-frontend" cmd /k "cd /d %YB_DIR%frontend && npm run dev"

echo.
echo 开发模式已启动:
echo   前端: http://127.0.0.1:3000  (已代理 /api 到后端 8000)
echo   后端: http://127.0.0.1:8000
echo   生产构建请用 build.bat 后运行 start-prod.bat
pause
