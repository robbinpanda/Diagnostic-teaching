@echo off
title ai4edu-web
setlocal
chcp 65001 >nul
echo [WEB] Starting Next.js frontend...
echo [WEB] URL: http://127.0.0.1:3000
echo [WEB] Press Ctrl+C to stop this service.
echo.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if %errorlevel%==0 (
  echo [WEB] Port 3000 is already in use.
  echo [WEB] The frontend is probably already running.
  echo [WEB] Open http://127.0.0.1:3000 in your browser, or run stop-dev.cmd first.
  echo.
  pause
  exit /b 0
)
set "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8010"
set "PATH=C:\Windows\System32;C:\Windows;C:\nvm4w\nodejs;C:\Users\robbinpanda\AppData\Local\nvm;%PATH%"
cd /d "%~dp0..\apps\web"
C:\nvm4w\nodejs\npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
echo.
echo [WEB] Frontend stopped or failed.
pause
