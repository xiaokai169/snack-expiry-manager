@echo off
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"

rem 默认端口上已有服务时，直接打开浏览器，避免端口冲突
if "%~1"=="" (
    curl -s --max-time 2 http://127.0.0.1:8765/api/health >nul 2>nul
    if not errorlevel 1 (
        echo 服务已在运行，正在打开浏览器...
        start "" http://127.0.0.1:8765
        exit /b 0
    )
)

rem 优先使用自定义 Python 环境，其次项目内 .venv，最后使用系统 python
set "PYTHON="
if defined SNACK_PYTHON set "PYTHON=%SNACK_PYTHON%"
if not defined PYTHON if exist "%~dp0python-path.txt" set /p PYTHON=<"%~dp0python-path.txt"
if not defined PYTHON if exist "%~dp0.venv\Scripts\python.exe" set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not defined PYTHON set "PYTHON=python"

echo 正在启动零食店效期管家...
"%PYTHON%" server.py %*
pause
