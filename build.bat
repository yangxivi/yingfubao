@echo off
chcp 65001 >nul
echo ========================================
echo   应付宝 - 前端构建脚本
echo ========================================
set "YB_DIR=%~dp0"
cd /d "%YB_DIR%frontend"
call npm.cmd run build
if %ERRORLEVEL% EQU 0 (
    echo.
    echo 构建成功！产出目录: frontend\dist\
    echo 使用 start-prod.bat 启动生产模式
) else (
    echo.
    echo 构建失败，请检查错误信息
)
pause
