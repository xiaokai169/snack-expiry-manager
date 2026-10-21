@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  安装零食店效期管家运行环境
echo  需要联网下载 PaddleOCR 等依赖，约 1GB
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+ 并勾选 Add to PATH。
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] 创建虚拟环境 .venv ...
    python -m venv .venv
    if errorlevel 1 goto :error
)

echo [2/3] 升级 pip ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error

echo [3/3] 安装依赖（耗时较长，请耐心等待）...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo 安装完成，运行 start.bat 即可启动。
pause
exit /b 0

:error
echo.
echo [错误] 安装失败，请检查网络或 Python 版本。
pause
exit /b 1
