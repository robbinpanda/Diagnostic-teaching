@echo off
setlocal
cd /d "%~dp0.."
set "CUSTOM_COMPILE_COMMAND=scripts\lock-python-deps.cmd"
python -m piptools compile ^
  --resolver=backtracking ^
  --generate-hashes ^
  --strip-extras ^
  --output-file=apps/api/requirements-core.txt ^
  apps/api/requirements-core.in
exit /b %errorlevel%
