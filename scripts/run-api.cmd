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

REM Locate conda (prefer conda.exe; fall back to common per-user install locations)
set "CONDA_EXE="
for /f "delims=" %%c in ('where conda 2^>nul ^| findstr /i "\.exe$"') do set "CONDA_EXE=%%c"
if not defined CONDA_EXE if exist "%USERPROFILE%\miniconda3\Scripts\conda.exe" set "CONDA_EXE=%USERPROFILE%\miniconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%USERPROFILE%\anaconda3\Scripts\conda.exe" set "CONDA_EXE=%USERPROFILE%\anaconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%LOCALAPPDATA%\miniconda3\Scripts\conda.exe" set "CONDA_EXE=%LOCALAPPDATA%\miniconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%LOCALAPPDATA%\anaconda3\Scripts\conda.exe" set "CONDA_EXE=%LOCALAPPDATA%\anaconda3\Scripts\conda.exe"
if not defined CONDA_EXE (
  echo [API] conda not found. Install Anaconda/Miniconda or add it to PATH.
  pause
  exit /b 1
)

cd /d "%~dp0..\apps\api"
REM Resolve the python interpreter of the ai4edu-tutor env and run uvicorn directly
for /f "delims=" %%b in ('%CONDA_EXE% info --base 2^>nul') do set "CONDA_BASE=%%b"
set "ENV_PYTHON=%CONDA_BASE%\envs\ai4edu-tutor\python.exe"
if not exist "%ENV_PYTHON%" (
  echo [API] conda env "ai4edu-tutor" not found at %ENV_PYTHON%.
  echo [API] Create it with: conda create -n ai4edu-tutor python=3.11
  echo [API] then: conda run -n ai4edu-tutor python scripts/install-python-deps.py dev
  pause
  exit /b 1
)
"%ENV_PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8010
echo.
echo [API] Backend stopped or failed.
pause
