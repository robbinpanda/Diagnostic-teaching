@echo off
title ai4edu-start
setlocal
chcp 65001 >nul
echo Starting diagnostic math tutor MVP...
echo.
start "ai4edu-api" cmd /k ""%~dp0run-api.cmd""
start "ai4edu-web" cmd /k ""%~dp0run-web.cmd""
echo API: http://127.0.0.1:8010
echo Web: http://127.0.0.1:3000
echo.
echo Two service windows should now be open:
echo - ai4edu-api
echo - ai4edu-web
echo.
echo Close this window whenever you like. To stop the project, close the two service windows
echo or double-click scripts\stop-dev.cmd.
echo.
pause
