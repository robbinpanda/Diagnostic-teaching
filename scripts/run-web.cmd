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

REM Locate node: prefer node on PATH, else the newest version under nvm
set "NODE_DIR="
where node >nul 2>&1 && (
  for /f "delims=" %%i in ('where node') do set "NODE_DIR=%%~dpi" & goto :haveNode
)
if exist "%LOCALAPPDATA%\nvm" (
  for /f "delims=" %%d in ('dir /b /ad /o-n "%LOCALAPPDATA%\nvm\v*" 2^>nul') do (
    set "NODE_DIR=%LOCALAPPDATA%\nvm\%%d\"
    goto :haveNode
  )
)
if exist "%ProgramFiles%\nodejs" set "NODE_DIR=%ProgramFiles%\nodejs\"
:haveNode
if not defined NODE_DIR (
  echo [WEB] node not found. Install Node.js or nvm-windows, or add node to PATH.
  pause
  exit /b 1
)

set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0..\apps\web"
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
echo.
echo [WEB] Frontend stopped or failed.
pause
