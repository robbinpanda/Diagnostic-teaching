@echo off
setlocal
chcp 65001 >nul

REM Locate conda with the same rules as run-api.cmd.
set "CONDA_EXE="
for /f "delims=" %%c in ('where conda 2^>nul ^| findstr /i "\.exe$"') do set "CONDA_EXE=%%c"
if not defined CONDA_EXE if exist "%USERPROFILE%\miniconda3\Scripts\conda.exe" set "CONDA_EXE=%USERPROFILE%\miniconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%USERPROFILE%\anaconda3\Scripts\conda.exe" set "CONDA_EXE=%USERPROFILE%\anaconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%LOCALAPPDATA%\miniconda3\Scripts\conda.exe" set "CONDA_EXE=%LOCALAPPDATA%\miniconda3\Scripts\conda.exe"
if not defined CONDA_EXE if exist "%LOCALAPPDATA%\anaconda3\Scripts\conda.exe" set "CONDA_EXE=%LOCALAPPDATA%\anaconda3\Scripts\conda.exe"
if not defined CONDA_EXE (
  echo [INSPECT] conda not found. Install Anaconda/Miniconda or add it to PATH.
  pause
  exit /b 1
)

for /f "delims=" %%b in ('%CONDA_EXE% info --base 2^>nul') do set "CONDA_BASE=%%b"
set "PY=%CONDA_BASE%\envs\ai4edu-tutor\python.exe"
if not exist "%PY%" (
  echo [INSPECT] conda env "ai4edu-tutor" not found at %PY%.
  echo [INSPECT] Create it with: conda create -n ai4edu-tutor python=3.11
  pause
  exit /b 1
)

if "%~1"=="" (
  "%PY%" "%~dp0inspect-session.py"
) else (
  "%PY%" "%~dp0inspect-session.py" %*
)
echo.
pause
