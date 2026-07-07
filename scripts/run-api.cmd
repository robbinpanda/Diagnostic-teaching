@echo off
title ai4edu-api
setlocal
chcp 65001 >nul
echo [API] Starting FastAPI backend...
echo [API] URL: http://127.0.0.1:8010
echo [API] Press Ctrl+C to stop this service.
echo.
netstat -ano | findstr /R /C:":8010 .*LISTENING" >nul
if %errorlevel%==0 (
  echo [API] Port 8010 is already in use.
  echo [API] The backend is probably already running.
  echo [API] Open http://127.0.0.1:3000 in your browser, or run stop-dev.cmd first.
  echo.
  pause
  exit /b 0
)
set "PATH=C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Users\robbinpanda\miniconda3;C:\Users\robbinpanda\miniconda3\Scripts;C:\Users\robbinpanda\miniconda3\condabin;%PATH%"
cd /d "%~dp0..\apps\api"
C:\Users\robbinpanda\miniconda3\Scripts\conda.exe run -n ai4edu-tutor uvicorn app.main:app --host 127.0.0.1 --port 8010
echo.
echo [API] Backend stopped or failed.
pause
