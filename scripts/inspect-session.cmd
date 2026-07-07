@echo off
setlocal
chcp 65001 >nul
set "PY=C:\Users\robbinpanda\miniconda3\envs\ai4edu-tutor\python.exe"
if "%~1"=="" (
  "%PY%" "%~dp0inspect-session.py"
) else (
  "%PY%" "%~dp0inspect-session.py" %*
)
echo.
pause
