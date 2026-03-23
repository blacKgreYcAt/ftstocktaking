@echo off
title 大豐資訊盤點系統啟動器
setlocal enabledelayedexpansion

echo ----------------------------------------------------
echo [1/3] 正在檢查 Python 環境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Python，請先安裝 Python 並勾選 "Add Python to PATH"。
    pause
    exit /b
)

echo [2/3] 正在安裝必要套件 (Flask)...
python -m pip install -r requirements.txt --quiet

echo [3/3] 正在取得本機 IP 位址...
:: 透過 route print 找到預設閘道的介面 IP
set "IP=localhost"
for /f "tokens=4" %%a in ('route print ^| findstr "\<0.0.0.0\>"') do (
    set "IP=%%a"
)

echo.
echo ====================================================
echo    大豐資訊盤點系統已成功啟動
echo ====================================================
echo.
echo  * 本機作業網址: http://localhost:5000
echo  * 他機連線網址: http://!IP!:5000
echo.
echo  (請保持此視窗開啟，縮小即可)
echo ====================================================
echo.

:: 啟動瀏覽器
start http://localhost:5000

:: 執行伺服器
python inventory_app.py

pause